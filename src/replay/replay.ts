import { runPool } from "../engine/pool.js";
import { sendRequest } from "./http-client.js";
import type { PairResult, ReplayRequest } from "./types.js";

export interface ReplayTargets {
  baselineUrl: string;
  candidateUrl: string;
  timeoutMs: number;
}

// Both sides are sent at the same moment so they see similar load, and the pair
// takes max(b, c) instead of b + c. Safe with Promise.all because sendRequest never throws.
export async function replayPair(request: ReplayRequest, t: ReplayTargets): Promise<PairResult> {
  const [baseline, candidate] = await Promise.all([
    sendRequest(t.baselineUrl, request, t.timeoutMs),
    sendRequest(t.candidateUrl, request, t.timeoutMs),
  ]);
  return { request, baseline, candidate };
}

export function replayAll(requests: readonly ReplayRequest[], t: ReplayTargets, concurrency: number): Promise<PairResult[]> {
  return runPool(requests, concurrency, (request) => replayPair(request, t));
}
