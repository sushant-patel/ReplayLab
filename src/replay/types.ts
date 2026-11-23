export interface ReplayRequest {
  id: string; // stable id ("user-101") so results can be matched across runs
  method: "GET"; // only safe requests are replayed
  path: string; // path + query, e.g. "/users?role=admin&limit=2"
  headers: Record<string, string>;
}

/**
 * Outcome of one request against one API.
 * A 404/500 is still a "response" (the server answered); "error" means no HTTP response at all.
 */
export type HttpResult =
  | {
      kind: "response";
      status: number;
      headers: Record<string, string>;
      body: unknown; // parsed JSON, or the raw text if it isn't JSON
      rawBody: string;
      latencyMs: number;
    }
  | {
      kind: "error";
      errorType: "timeout" | "connection" | "unknown";
      message: string;
      latencyMs: number; // time until we gave up
    };

export interface PairResult {
  request: ReplayRequest;
  baseline: HttpResult;
  candidate: HttpResult;
}
