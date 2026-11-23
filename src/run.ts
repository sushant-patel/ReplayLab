// Orchestrates one replay session: expand -> warm up -> replay -> compare -> measure -> gate.
import { comparePair, type Comparison } from "./compare/compare.js";
import { IgnoreRules } from "./compare/ignore.js";
import type { ReplayLabConfig, Thresholds } from "./config.js";
import { routeKey, summarize, type LatencyStats } from "./metrics/stats.js";
import { replayAll, type ReplayTargets } from "./replay/replay.js";
import type { HttpResult, ReplayRequest } from "./replay/types.js";

export interface RouteLatency {
  route: string;
  baseline: LatencyStats | null;
  candidate: LatencyStats | null;
  p95DeltaPct: number | null; // +40 = candidate p95 is 40% slower
  regressed: boolean;
}

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number; // measured phase only (warm-up excluded)
  baselineUrl: string;
  candidateUrl: string;
  concurrency: number;
  totals: { requests: number; passed: number; failed: number; errored: number; withWarnings: number };
  throughputPairsPerSec: number;
  errorRatePct: { baseline: number; candidate: number };
  latency: { baseline: LatencyStats | null; candidate: LatencyStats | null };
  routes: RouteLatency[];
  gate: { passed: boolean; reasons: string[] };
}

export interface RunResult {
  summary: RunSummary;
  comparisons: Comparison[];
}

/** Repeats the fixture set; ids get a "#n" suffix so every request id stays unique. */
export function expandRequests(requests: readonly ReplayRequest[], repeat: number): ReplayRequest[] {
  if (repeat <= 1) return [...requests];
  const out: ReplayRequest[] = [];
  for (let n = 1; n <= repeat; n++) for (const r of requests) out.push({ ...r, id: `${r.id}#${n}` });
  return out;
}

const latencyOf = (r: HttpResult): number | null => (r.kind === "response" ? r.latencyMs : null);
const pct = (part: number, whole: number): number => (whole === 0 ? 0 : (part / whole) * 100);

export async function runReplay(fixtures: readonly ReplayRequest[], cfg: ReplayLabConfig): Promise<RunResult> {
  const requests = expandRequests(fixtures, cfg.repeat);
  const targets: ReplayTargets = { baselineUrl: cfg.baselineUrl, candidateUrl: cfg.candidateUrl, timeoutMs: cfg.timeoutMs };

  // Warm-up: open keep-alive connections and let both servers JIT-compile hot paths.
  // Results are thrown away so cold-start latency doesn't pollute the percentiles.
  if (cfg.warmupRequests > 0) await replayAll(requests.slice(0, cfg.warmupRequests), targets, cfg.concurrency);

  const startedAt = new Date();
  const t0 = performance.now();
  const pairs = await replayAll(requests, targets, cfg.concurrency);
  const durationMs = performance.now() - t0;

  const options = {
    ignore: new IgnoreRules(cfg.ignorePaths),
    compareHeaders: cfg.compareHeaders.map((h) => h.toLowerCase()),
    addedFieldsAreBreaking: cfg.thresholds.addedFieldsAreBreaking,
  };
  const comparisons = pairs.map((p) => comparePair(p, options));

  const summary = summarizeRun(comparisons, cfg, startedAt, durationMs);
  return { summary, comparisons };
}

export function summarizeRun(comparisons: Comparison[], cfg: ReplayLabConfig, startedAt: Date, durationMs: number): RunSummary {
  const n = comparisons.length;
  const count = (v: Comparison["verdict"]) => comparisons.filter((c) => c.verdict === v).length;

  // Group latencies per route: an overall p95 can hide one endpoint getting 10x slower.
  const byRoute = new Map<string, { b: number[]; c: number[] }>();
  for (const { pair } of comparisons) {
    const key = routeKey(pair.request.path);
    const bucket = byRoute.get(key) ?? { b: [], c: [] };
    const bl = latencyOf(pair.baseline);
    const cl = latencyOf(pair.candidate);
    if (bl !== null) bucket.b.push(bl);
    if (cl !== null) bucket.c.push(cl);
    byRoute.set(key, bucket);
  }

  const routes: RouteLatency[] = [...byRoute.entries()]
    .map(([route, { b, c }]) => {
      const baseline = summarize(b);
      const candidate = summarize(c);
      return { route, baseline, candidate, ...judgeLatency(baseline, candidate, cfg.thresholds) };
    })
    .sort((x, y) => x.route.localeCompare(y.route));

  const summary: RunSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date(startedAt.getTime() + durationMs).toISOString(),
    durationMs,
    baselineUrl: cfg.baselineUrl,
    candidateUrl: cfg.candidateUrl,
    concurrency: cfg.concurrency,
    totals: {
      requests: n,
      passed: count("pass"),
      failed: count("fail"),
      errored: count("error"),
      withWarnings: comparisons.filter((c) => c.findings.some((f) => f.severity === "warning")).length,
    },
    throughputPairsPerSec: durationMs > 0 ? (n / durationMs) * 1000 : 0,
    errorRatePct: {
      baseline: pct(comparisons.filter((c) => c.pair.baseline.kind === "error").length, n),
      candidate: pct(comparisons.filter((c) => c.pair.candidate.kind === "error").length, n),
    },
    latency: {
      baseline: summarize(comparisons.map((c) => latencyOf(c.pair.baseline)).filter((v) => v !== null)),
      candidate: summarize(comparisons.map((c) => latencyOf(c.pair.candidate)).filter((v) => v !== null)),
    },
    routes,
    gate: { passed: true, reasons: [] },
  };
  summary.gate = evaluateGate(summary, cfg.thresholds);
  return summary;
}

/** Latency regression rule: candidate p95 > baseline p95 * (1 + pct) + tolerance. */
export function judgeLatency(
  baseline: LatencyStats | null,
  candidate: LatencyStats | null,
  t: Thresholds,
): { p95DeltaPct: number | null; regressed: boolean } {
  if (!baseline || !candidate) return { p95DeltaPct: null, regressed: false };
  const p95DeltaPct = baseline.p95 > 0 ? ((candidate.p95 - baseline.p95) / baseline.p95) * 100 : null;
  const enoughSamples = baseline.count >= t.minSamplesForLatency && candidate.count >= t.minSamplesForLatency;
  const limit = baseline.p95 * (1 + t.p95RegressionPct / 100) + t.p95ToleranceMs;
  return { p95DeltaPct, regressed: enoughSamples && candidate.p95 > limit };
}

/** The build gate: every reason listed here turns the CI run red. */
export function evaluateGate(s: RunSummary, t: Thresholds): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (s.totals.requests === 0) reasons.push("no requests were replayed (empty fixtures cannot prove anything)");
  if (s.totals.failed > t.maxFailedRequests) {
    reasons.push(`${s.totals.failed} request(s) regressed (allowed: ${t.maxFailedRequests})`);
  }
  if (s.totals.errored > 0) reasons.push(`${s.totals.errored} request(s) could not be judged: the baseline itself failed`);
  if (s.errorRatePct.candidate > t.maxCandidateErrorRatePct) {
    reasons.push(`candidate error rate ${s.errorRatePct.candidate.toFixed(1)}% (allowed: ${t.maxCandidateErrorRatePct}%)`);
  }
  for (const r of s.routes) {
    if (r.regressed && r.baseline && r.candidate) {
      reasons.push(
        `latency regression on ${r.route}: p95 ${r.baseline.p95.toFixed(1)}ms -> ${r.candidate.p95.toFixed(1)}ms (+${(r.p95DeltaPct ?? 0).toFixed(0)}%)`,
      );
    }
  }
  return { passed: reasons.length === 0, reasons };
}
