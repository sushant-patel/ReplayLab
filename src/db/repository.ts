import { readFile } from "node:fs/promises";
import pg from "pg";
import type { RunResult, RunSummary } from "../run.js";

export const DEFAULT_DATABASE_URL = "postgres://replaylab:replaylab@127.0.0.1:5433/replaylab";

export function createPool(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
}

export async function ensureSchema(pool: pg.Pool): Promise<void> {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

// SQL NULL when the side has no value at all; JSON null stays 'null'
const toJsonb = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));

// One transaction per run. Rows go in with unnest() over column arrays: one INSERT per
// table instead of one per row (1,000 results = 3 round trips, not ~3,000).
export async function saveRun(pool: pg.Pool, { summary, comparisons }: RunResult): Promise<number> {
  const client = await pool.connect(); // BEGIN/COMMIT must run on the same connection
  try {
    await client.query("BEGIN");

    const run = await client.query<{ id: string }>(
      `INSERT INTO replay_runs (started_at, finished_at, baseline_url, candidate_url, concurrency,
         total_requests, passed, failed, errored, gate_passed, summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        summary.startedAt, summary.finishedAt, summary.baselineUrl, summary.candidateUrl, summary.concurrency,
        summary.totals.requests, summary.totals.passed, summary.totals.failed, summary.totals.errored,
        summary.gate.passed, JSON.stringify(summary),
      ],
    );
    const runId = Number(run.rows[0]?.id); // pg returns BIGSERIAL as a string

    const cols = {
      requestId: [] as string[], method: [] as string[], path: [] as string[], verdict: [] as string[],
      bStatus: [] as (number | null)[], cStatus: [] as (number | null)[],
      bLat: [] as (number | null)[], cLat: [] as (number | null)[],
      bErr: [] as (string | null)[], cErr: [] as (string | null)[],
    };
    for (const { pair, verdict } of comparisons) {
      const { request, baseline: b, candidate: c } = pair;
      cols.requestId.push(request.id); cols.method.push(request.method); cols.path.push(request.path); cols.verdict.push(verdict);
      cols.bStatus.push(b.kind === "response" ? b.status : null); cols.cStatus.push(c.kind === "response" ? c.status : null);
      cols.bLat.push(b.latencyMs); cols.cLat.push(c.latencyMs);
      cols.bErr.push(b.kind === "error" ? `${b.errorType}: ${b.message}` : null);
      cols.cErr.push(c.kind === "error" ? `${c.errorType}: ${c.message}` : null);
    }

    const inserted = await client.query<{ id: string; request_id: string }>(
      `INSERT INTO request_results (run_id, request_id, method, path, verdict, baseline_status, candidate_status,
         baseline_latency_ms, candidate_latency_ms, baseline_error, candidate_error)
       SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[],
         $8::float8[], $9::float8[], $10::text[], $11::text[])
       RETURNING id, request_id`,
      [runId, cols.requestId, cols.method, cols.path, cols.verdict, cols.bStatus, cols.cStatus, cols.bLat, cols.cLat, cols.bErr, cols.cErr],
    );
    const resultIdByRequest = new Map(inserted.rows.map((r) => [r.request_id, r.id]));

    const diff = { resultId: [] as string[], kind: [] as string[], path: [] as string[], severity: [] as string[], b: [] as (string | null)[], c: [] as (string | null)[] };
    for (const { pair, findings } of comparisons) {
      const resultId = resultIdByRequest.get(pair.request.id);
      if (resultId === undefined) continue;
      for (const f of findings) {
        diff.resultId.push(resultId); diff.kind.push(f.kind); diff.path.push(f.path); diff.severity.push(f.severity);
        diff.b.push(toJsonb(f.baseline)); diff.c.push(toJsonb(f.candidate));
      }
    }
    if (diff.kind.length > 0) {
      await client.query(
        `INSERT INTO differences (result_id, kind, json_path, severity, baseline_value, candidate_value)
         SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::jsonb[], $6::jsonb[])`,
        [diff.resultId, diff.kind, diff.path, diff.severity, diff.b, diff.c],
      );
    }

    await client.query("COMMIT");
    return runId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface RunRow {
  id: string;
  started_at: Date;
  total_requests: number;
  passed: number;
  failed: number;
  errored: number;
  gate_passed: boolean;
  candidate_url: string;
}

export async function listRuns(pool: pg.Pool, limit = 10): Promise<RunRow[]> {
  const { rows } = await pool.query<RunRow>(
    `SELECT id, started_at, total_requests, passed, failed, errored, gate_passed, candidate_url
       FROM replay_runs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export interface StoredFailure {
  request_id: string;
  path: string;
  verdict: string;
  kind: string | null;
  json_path: string | null;
  baseline_value: unknown;
  candidate_value: unknown;
}

export async function getRun(pool: pg.Pool, runId: number): Promise<{ summary: RunSummary; failures: StoredFailure[] } | null> {
  const run = await pool.query<{ summary: RunSummary }>("SELECT summary FROM replay_runs WHERE id = $1", [runId]);
  const first = run.rows[0];
  if (!first) return null;
  // idx_request_results_run_verdict + idx_differences_result_id
  const failures = await pool.query<StoredFailure>(
    `SELECT r.request_id, r.path, r.verdict, d.kind, d.json_path, d.baseline_value, d.candidate_value
       FROM request_results r
       LEFT JOIN differences d ON d.result_id = r.id
      WHERE r.run_id = $1 AND r.verdict <> 'pass'
      ORDER BY r.request_id, d.id`,
    [runId],
  );
  return { summary: first.summary, failures: failures.rows };
}
