import type { Finding } from "../compare/compare.js";
import type { LatencyStats } from "../metrics/stats.js";
import type { RunResult } from "../run.js";

const f1 = (v: number | undefined) => (v === undefined ? "–" : v.toFixed(1));
const short = (v: unknown) => {
  const s = JSON.stringify(v) ?? "undefined";
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
};

function statsLine(label: string, s: LatencyStats | null): string {
  if (!s) return `  ${label.padEnd(10)} no successful responses`;
  return `  ${label.padEnd(10)} n=${String(s.count).padEnd(5)} p50 ${f1(s.p50).padStart(7)}  p95 ${f1(s.p95).padStart(7)}  p99 ${f1(s.p99).padStart(7)}  max ${f1(s.max).padStart(7)} ms`;
}

export function describeFinding(f: Finding): string {
  switch (f.kind) {
    case "missing_field": return `Missing field ${f.path}`;
    case "added_field": return `Added field ${f.path} (${f.severity})`;
    case "request_failed": return `Request failed on ${f.path}: ${String(f.baseline ?? f.candidate)}`;
    default: return `${f.kind.replaceAll("_", " ")} ${f.path}: ${short(f.baseline)} -> ${short(f.candidate)}`;
  }
}

export function printSummary({ summary: s, comparisons }: RunResult, maxFailures = 12): void {
  const t = s.totals;
  console.log(`\n${t.requests} pairs in ${s.durationMs.toFixed(0)} ms | ${s.throughputPairsPerSec.toFixed(1)} pairs/s | concurrency ${s.concurrency}`);
  console.log(`  passed ${t.passed}  regressed ${t.failed}  not judged ${t.errored}  (with warnings ${t.withWarnings})`);
  console.log(`  error rate: baseline ${s.errorRatePct.baseline.toFixed(1)}%  candidate ${s.errorRatePct.candidate.toFixed(1)}%`);

  console.log("\nLatency (ms)");
  console.log(statsLine("baseline", s.latency.baseline));
  console.log(statsLine("candidate", s.latency.candidate));

  console.log("\nBy route              n   p95 base   p95 cand    Δ p95");
  for (const r of s.routes) {
    const delta = r.p95DeltaPct === null ? "–" : `${r.p95DeltaPct >= 0 ? "+" : ""}${r.p95DeltaPct.toFixed(0)}%`;
    console.log(
      `  ${r.route.padEnd(18)}${String(r.baseline?.count ?? 0).padStart(4)} ${f1(r.baseline?.p95).padStart(10)} ${f1(r.candidate?.p95).padStart(10)} ${delta.padStart(8)}${r.regressed ? "  << REGRESSED" : ""}`,
    );
  }

  const bad = comparisons.filter((c) => c.verdict !== "pass");
  if (bad.length > 0) {
    console.log(`\nRegressions (${bad.length}, showing ${Math.min(maxFailures, bad.length)})`);
    for (const c of bad.slice(0, maxFailures)) {
      console.log(`  [${c.verdict.toUpperCase()}] ${c.pair.request.id}  ${c.pair.request.path}`);
      for (const f of c.findings.slice(0, 4)) console.log(`      - ${describeFinding(f)}`);
      if (c.findings.length > 4) console.log(`      ... ${c.findings.length - 4} more`);
    }
  }

  console.log(`\nGate: ${s.gate.passed ? "PASS" : "FAIL"}`);
  for (const reason of s.gate.reasons) console.log(`  - ${reason}`);
}
