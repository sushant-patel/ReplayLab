import { describe, expect, it } from "vitest";
import { comparePair, type CompareOptions } from "../../src/compare/compare.js";
import { IgnoreRules } from "../../src/compare/ignore.js";
import type { HttpResult, PairResult } from "../../src/replay/types.js";

const opts: CompareOptions = {
  ignore: new IgnoreRules(["$.timestamp"]),
  compareHeaders: ["content-type"],
  addedFieldsAreBreaking: false,
};

const ok = (status: number, body: unknown, contentType = "application/json"): HttpResult => ({
  kind: "response",
  status,
  headers: { "content-type": contentType },
  body,
  rawBody: JSON.stringify(body),
  latencyMs: 5,
});

const pair = (baseline: HttpResult, candidate: HttpResult): PairResult => ({
  request: { id: "r1", method: "GET", path: "/x", headers: {} },
  baseline,
  candidate,
});

describe("comparePair", () => {
  it("passes identical responses", () => {
    expect(comparePair(pair(ok(200, { a: 1 }), ok(200, { a: 1 })), opts).verdict).toBe("pass");
  });

  it("passes when only ignored fields differ (normalization)", () => {
    const r = comparePair(pair(ok(200, { a: 1, timestamp: "t1" }), ok(200, { a: 1, timestamp: "t2" })), opts);
    expect(r.verdict).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("fails on a status change", () => {
    const r = comparePair(pair(ok(404, {}), ok(500, {})), opts);
    expect(r.verdict).toBe("fail");
    expect(r.findings[0]).toMatchObject({ kind: "status_changed", baseline: 404, candidate: 500 });
  });

  it("fails on a content-type header change", () => {
    const r = comparePair(pair(ok(200, "x", "application/json"), ok(200, "x", "text/html")), opts);
    expect(r.findings[0]).toMatchObject({ kind: "header_changed", path: "headers.content-type" });
  });

  it("treats added fields as warnings by default, breaking when configured", () => {
    const p = pair(ok(200, { a: 1 }), ok(200, { a: 1, b: 2 }));
    expect(comparePair(p, opts).verdict).toBe("pass");
    expect(comparePair(p, { ...opts, addedFieldsAreBreaking: true }).verdict).toBe("fail");
  });

  it("fails when the candidate times out but the baseline answered", () => {
    const timeout: HttpResult = { kind: "error", errorType: "timeout", message: "no response", latencyMs: 2000 };
    expect(comparePair(pair(ok(200, {}), timeout), opts).verdict).toBe("fail");
  });

  it("marks the request as not judgeable when the baseline failed", () => {
    const refused: HttpResult = { kind: "error", errorType: "connection", message: "ECONNREFUSED", latencyMs: 1 };
    expect(comparePair(pair(refused, ok(200, {})), opts).verdict).toBe("error");
  });
});
