// ReplayLab configuration: defaults <- replaylab.config.json <- CLI flags.
import { readFile } from "node:fs/promises";

export interface Thresholds {
  maxFailedRequests: number; // functional regressions tolerated (0 = any regression fails the build)
  maxCandidateErrorRatePct: number; // % of candidate requests allowed to time out / fail to connect
  p95RegressionPct: number; // allowed relative p95 slowdown per route
  p95ToleranceMs: number; // absolute slack so timer jitter can't fail a build on its own
  minSamplesForLatency: number; // don't judge a route's latency on fewer samples than this
  addedFieldsAreBreaking: boolean; // new fields are usually backward compatible
}

export interface ReplayLabConfig {
  baselineUrl: string;
  candidateUrl: string;
  fixtures: string;
  timeoutMs: number;
  concurrency: number; // max pairs in flight at once
  repeat: number; // replay the fixture set N times (more latency samples per route)
  warmupRequests: number; // pairs sent before measuring (opens connections, warms JIT)
  ignorePaths: string[]; // JSONPath patterns whose differences are noise
  compareHeaders: string[];
  thresholds: Thresholds;
}

export const DEFAULT_CONFIG: ReplayLabConfig = {
  baselineUrl: "http://127.0.0.1:3001",
  candidateUrl: "http://127.0.0.1:3002",
  fixtures: "fixtures/requests.json",
  timeoutMs: 2000,
  concurrency: 10,
  repeat: 1,
  warmupRequests: 5,
  ignorePaths: [],
  compareHeaders: ["content-type"],
  thresholds: {
    maxFailedRequests: 0,
    maxCandidateErrorRatePct: 0,
    p95RegressionPct: 25,
    p95ToleranceMs: 5,
    minSamplesForLatency: 10,
    addedFieldsAreBreaking: false,
  },
};

export async function loadConfig(file: string | undefined): Promise<ReplayLabConfig> {
  if (!file) return structuredClone(DEFAULT_CONFIG);
  const fromFile = JSON.parse(await readFile(file, "utf8")) as Partial<ReplayLabConfig>;
  // Shallow merge, plus a nested merge for thresholds so a file can override just one threshold.
  return {
    ...DEFAULT_CONFIG,
    ...fromFile,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...fromFile.thresholds },
  };
}
