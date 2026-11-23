// ReplayLab command-line entry point.
//
//   npm run replay -- [run] [--concurrency 20] [--repeat 10] [--save]   replay + compare + gate
//   npm run replay -- bench --levels 1,5,20 --repeat 20                  concurrency benchmark
//   npm run replay -- history                                            past runs (PostgreSQL)
//   npm run replay -- show <runId>                                       one stored run
//
// Exit codes are the CI contract:
//   0 = no regressions   1 = regressions found (block the deploy)   2 = ReplayLab itself failed
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig, type ReplayLabConfig } from "./config.js";
import { createPool, ensureSchema, getRun, listRuns, saveRun } from "./db/repository.js";
import { printSummary } from "./report/console.js";
import { renderReport } from "./report/html.js";
import { loadFixtures } from "./replay/fixtures.js";
import { runReplay } from "./run.js";

const EXIT = { PASS: 0, REGRESSION: 1, TOOL_ERROR: 2 } as const;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string", default: "replaylab.config.json" },
    fixtures: { type: "string" },
    baseline: { type: "string" },
    candidate: { type: "string" },
    timeout: { type: "string" },
    concurrency: { type: "string" },
    repeat: { type: "string" },
    warmup: { type: "string" },
    report: { type: "string" },
    save: { type: "boolean", default: false },
    levels: { type: "string", default: "1,5,20" },
    limit: { type: "string", default: "10" },
  },
});

/** Parses a numeric flag, failing loudly on garbage like "--concurrency ten". */
function num(flag: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${flag} must be a non-negative number, got "${raw}"`);
  return n;
}

async function buildConfig(): Promise<ReplayLabConfig> {
  const cfg = await loadConfig(values.config);
  return {
    ...cfg,
    fixtures: values.fixtures ?? cfg.fixtures,
    baselineUrl: values.baseline ?? cfg.baselineUrl,
    candidateUrl: values.candidate ?? cfg.candidateUrl,
    timeoutMs: num("timeout", values.timeout, cfg.timeoutMs),
    concurrency: num("concurrency", values.concurrency, cfg.concurrency),
    repeat: num("repeat", values.repeat, cfg.repeat),
    warmupRequests: num("warmup", values.warmup, cfg.warmupRequests),
  };
}

async function commandRun(): Promise<number> {
  const cfg = await buildConfig();
  const fixtures = await loadFixtures(cfg.fixtures);
  console.log(
    `ReplayLab: ${fixtures.length} fixtures x ${cfg.repeat} | baseline ${cfg.baselineUrl} | candidate ${cfg.candidateUrl} | timeout ${cfg.timeoutMs} ms`,
  );

  const result = await runReplay(fixtures, cfg);

  // If the baseline answered nothing, the environment is broken: that's a tool error,
  // not a verdict about the candidate.
  if (result.summary.totals.requests > 0 && result.summary.errorRatePct.baseline === 100) {
    console.error(`\nBaseline ${cfg.baselineUrl} did not answer any request. Is it running?`);
    return EXIT.TOOL_ERROR;
  }

  printSummary(result);

  const reportPath = values.report ?? `reports/replay-${result.summary.startedAt.replace(/[:.]/g, "-")}.html`;
  await mkdir("reports", { recursive: true });
  const html = renderReport(result);
  await writeFile(reportPath, html, "utf8");
  await writeFile("reports/latest.html", html, "utf8");
  console.log(`\nReport: ${reportPath}`);

  if (values.save) {
    const pool = createPool();
    try {
      await ensureSchema(pool);
      console.log(`Saved as run #${await saveRun(pool, result)}`);
    } finally {
      await pool.end(); // close pooled connections so the process can exit
    }
  }

  return result.summary.gate.passed ? EXIT.PASS : EXIT.REGRESSION;
}

async function commandBench(): Promise<number> {
  const base = await buildConfig();
  const fixtures = await loadFixtures(base.fixtures);
  const levels = values.levels.split(",").map((l) => num("levels", l.trim(), 1));
  const repeat = num("repeat", values.repeat, 10);

  console.log(`Benchmark: ${fixtures.length * repeat} pairs per level, levels ${levels.join(", ")}\n`);
  console.log("conc   pairs   time(ms)   pairs/s   base p50   base p95   base p99   cand p50   cand p95   cand p99");
  for (const concurrency of levels) {
    const { summary: s } = await runReplay(fixtures, { ...base, concurrency, repeat });
    const b = s.latency.baseline;
    const c = s.latency.candidate;
    const cell = (v: number | undefined) => (v === undefined ? "–" : v.toFixed(1)).padStart(10);
    console.log(
      `${String(concurrency).padStart(4)} ${String(s.totals.requests).padStart(7)} ${s.durationMs.toFixed(0).padStart(10)} ${s.throughputPairsPerSec.toFixed(1).padStart(9)}` +
        `${cell(b?.p50)}${cell(b?.p95)}${cell(b?.p99)}${cell(c?.p50)}${cell(c?.p95)}${cell(c?.p99)}`,
    );
  }
  return EXIT.PASS;
}

async function commandHistory(): Promise<number> {
  const pool = createPool();
  try {
    await ensureSchema(pool);
    const runs = await listRuns(pool, num("limit", values.limit, 10));
    if (runs.length === 0) console.log("No runs saved yet. Use: npm run replay -- --save");
    for (const r of runs) {
      console.log(
        `#${r.id.padEnd(4)} ${r.started_at.toISOString()}  ${r.gate_passed ? "PASS" : "FAIL"}  requests ${r.total_requests}  passed ${r.passed}  regressed ${r.failed}  not judged ${r.errored}  ${r.candidate_url}`,
      );
    }
    return EXIT.PASS;
  } finally {
    await pool.end();
  }
}

async function commandShow(id: string | undefined): Promise<number> {
  if (!id || !/^\d+$/.test(id)) throw new Error("usage: npm run replay -- show <runId>");
  const pool = createPool();
  try {
    const run = await getRun(pool, Number(id));
    if (!run) {
      console.error(`Run #${id} not found`);
      return EXIT.TOOL_ERROR;
    }
    const s = run.summary;
    console.log(`Run #${id} at ${s.startedAt}: gate ${s.gate.passed ? "PASS" : "FAIL"}`);
    for (const reason of s.gate.reasons) console.log(`  - ${reason}`);
    console.log(`\nNon-passing results (${new Set(run.failures.map((f) => f.request_id)).size}):`);
    for (const f of run.failures) {
      console.log(`  ${f.request_id.padEnd(24)} ${f.verdict.padEnd(6)} ${f.kind ?? ""} ${f.json_path ?? ""}`);
    }
    return EXIT.PASS;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<number> {
  const [command = "run", arg] = positionals;
  switch (command) {
    case "run": return commandRun();
    case "bench": return commandBench();
    case "history": return commandHistory();
    case "show": return commandShow(arg);
    default: throw new Error(`unknown command "${command}" (use run | bench | history | show)`);
  }
}

try {
  process.exitCode = await main(); // exitCode (not process.exit) lets pending output flush first
} catch (err) {
  console.error(`ReplayLab error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = EXIT.TOOL_ERROR;
}
