import { describe, expect, it } from "vitest";
import { IgnoreRules } from "../../src/compare/ignore.js";

describe("IgnoreRules", () => {
  const rules = new IgnoreRules(["$.timestamp", "$.users[*].displayName", "$.meta"]);

  it("matches an exact path", () => {
    expect(rules.matches("$.timestamp")).toBe(true);
  });

  it("does not match a different field that shares a prefix", () => {
    expect(rules.matches("$.timestampUtc")).toBe(false); // boundary check: must be followed by end, "." or "["
  });

  it("matches [*] against any array index", () => {
    expect(rules.matches("$.users[0].displayName")).toBe(true);
    expect(rules.matches("$.users[17].displayName")).toBe(true);
    expect(rules.matches("$.users[0].name")).toBe(false);
  });

  it("matches everything nested under an ignored path", () => {
    expect(rules.matches("$.meta.trace.id")).toBe(true);
    expect(rules.matches("$.meta[0]")).toBe(true);
  });

  it("treats regex characters in patterns literally", () => {
    expect(new IgnoreRules(["$.a.b"]).matches("$.aXb")).toBe(false); // "." must not mean "any char"
  });

  it("filters only covered differences", () => {
    const diffs = [{ path: "$.timestamp" }, { path: "$.role" }];
    expect(rules.filter(diffs)).toEqual([{ path: "$.role" }]);
  });
});
