import type { HttpResult, ReplayRequest } from "./types.js";

// fetch reports network failures as TypeError("fetch failed") with the real reason in err.cause.code.
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET", // undici's code when the server drops the socket mid-request (not ECONNRESET)
]);

/**
 * Sends one request and never throws: network failures come back as { kind: "error" }.
 * replayPair relies on this so one failing side can't reject Promise.all and lose the other.
 */
export async function sendRequest(baseUrl: string, req: ReplayRequest, timeoutMs: number): Promise<HttpResult> {
  const url = new URL(req.path, baseUrl);
  const start = performance.now();

  try {
    // fetch only rejects when there is no HTTP response at all; 404/500 resolve normally.
    const res = await fetch(url, {
      method: req.method,
      headers: req.headers,
      signal: AbortSignal.timeout(timeoutMs), // also covers res.text() below
    });

    // Read the body inside the try: a server can send headers and then stall.
    const rawBody = await res.text();
    const latencyMs = performance.now() - start; // full response, not just time-to-headers

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody; // HTML error pages etc. are still compared as text
    }

    return {
      kind: "response",
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body,
      rawBody,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = performance.now() - start;

    if (err instanceof Error) {
      if (err.name === "TimeoutError") {
        return { kind: "error", errorType: "timeout", message: `no response within ${timeoutMs} ms`, latencyMs };
      }
      const code = (err.cause as { code?: string } | undefined)?.code;
      if (code !== undefined && CONNECTION_ERROR_CODES.has(code)) {
        return { kind: "error", errorType: "connection", message: `${code} (${url.host})`, latencyMs };
      }
      return { kind: "error", errorType: "unknown", message: err.message, latencyMs };
    }
    return { kind: "error", errorType: "unknown", message: String(err), latencyMs };
  }
}
