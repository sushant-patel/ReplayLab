// Real Fastify servers on random ports, real replay over HTTP. No mocks.
import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { BASELINE_BEHAVIOR, buildApp, type Behavior } from "../../src/apis/app.js";
import { DEFAULT_CONFIG, type ReplayLabConfig } from "../../src/config.js";
import { loadFixtures } from "../../src/replay/fixtures.js";
import { runReplay } from "../../src/run.js";

process.env.LOG_LEVEL = "silent";
const started: FastifyInstance[] = [];

// port 0: OS picks a free port, so this never collides with dev servers
async function start(behavior: Behavior): Promise<string> {
  const app = buildApp(behavior);
  await app.listen({ port: 0, host: "127.0.0.1" });
  started.push(app);
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((app) => app.close()));
});

async function replayAgainst(candidate: Behavior, overrides: Partial<ReplayLabConfig> = {}) {
  const cfg: ReplayLabConfig = {
    ...DEFAULT_CONFIG,
    baselineUrl: await start(BASELINE_BEHAVIOR),
    candidateUrl: await start(candidate),
    ignorePaths: ["$.timestamp", "$.requestId", "$.version"],
    warmupRequests: 0,
    ...overrides,
  };
  return runReplay(await loadFixtures("fixtures/requests.json"), cfg);
}

const findingsOf = (result: Awaited<ReturnType<typeof replayAgainst>>, id: string) =>
  result.comparisons.find((c) => c.pair.request.id === id)?.findings ?? [];

describe("ReplayLab end-to-end", () => {
  it("passes when the candidate behaves like the baseline (no false positives)", async () => {
    const result = await replayAgainst({ ...BASELINE_BEHAVIOR, version: "2" });
    expect(result.summary.totals.failed).toBe(0);
    expect(result.summary.gate.passed).toBe(true);
  });

  it("detects a missing field", async () => {
    const result = await replayAgainst({ ...BASELINE_BEHAVIOR, dropAdminRole: true });
    expect(findingsOf(result, "user-101")).toContainEqual(expect.objectContaining({ kind: "missing_field", path: "$.role" }));
    expect(findingsOf(result, "user-102")).toEqual([]); // viewers keep their role
    expect(result.summary.gate.passed).toBe(false);
  });

  it("detects a type change", async () => {
    const result = await replayAgainst({ ...BASELINE_BEHAVIOR, nullEmptyTags: true });
    expect(findingsOf(result, "user-102")).toContainEqual(expect.objectContaining({ kind: "type_changed", path: "$.tags" }));
  });

  it("detects a status change", async () => {
    const result = await replayAgainst({ ...BASELINE_BEHAVIOR, crashOnMissingUser: true });
    expect(findingsOf(result, "user-999-missing")).toContainEqual(
      expect.objectContaining({ kind: "status_changed", baseline: 404, candidate: 500 }),
    );
  });

  it("detects a latency regression on the affected route only", async () => {
    const result = await replayAgainst({ ...BASELINE_BEHAVIOR, perUserDelayMs: 20 }, { repeat: 3, concurrency: 5 });
    const regressed = result.summary.routes.filter((r) => r.regressed).map((r) => r.route);
    expect(regressed).toEqual(["/users"]);
    expect(result.summary.totals.failed).toBe(0); // functionally identical, only slower
    expect(result.summary.gate.passed).toBe(false);
  });

  it("turns a hung candidate into timeouts instead of hanging", async () => {
    const result = await replayAgainst({ ...BASELINE_BEHAVIOR, perUserDelayMs: 500 }, { timeoutMs: 200 });
    const listDefault = result.comparisons.find((c) => c.pair.request.id === "list-default");
    expect(listDefault?.pair.candidate).toMatchObject({ kind: "error", errorType: "timeout" });
    expect(result.summary.errorRatePct.candidate).toBeGreaterThan(0);
  });
});
