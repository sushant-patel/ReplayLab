import { describe, expect, it } from "vitest";
import { diffJson, jsonType } from "../../src/compare/diff.js";

describe("jsonType", () => {
  it("distinguishes null and arrays from objects (typeof can't)", () => {
    expect(jsonType(null)).toBe("null");
    expect(jsonType([])).toBe("array");
    expect(jsonType({})).toBe("object");
    expect(jsonType(1)).toBe("number");
  });
});

describe("diffJson", () => {
  it("returns nothing for deeply equal values", () => {
    const doc = { id: 1, tags: ["a"], address: { city: "Pune" } };
    expect(diffJson(doc, structuredClone(doc))).toEqual([]);
  });

  it("detects a missing field (the $.role example)", () => {
    expect(diffJson({ id: 101, name: "Rahul", role: "admin" }, { id: 101, name: "Rahul" })).toEqual([
      { path: "$.role", kind: "missing_field", baseline: "admin" },
    ]);
  });

  it("detects an added field", () => {
    expect(diffJson({ id: 1 }, { id: 1, extra: true })).toEqual([{ path: "$.extra", kind: "added_field", candidate: true }]);
  });

  it("detects a type change and does not descend further", () => {
    expect(diffJson({ tags: [] }, { tags: null })).toEqual([{ path: "$.tags", kind: "type_changed", baseline: [], candidate: null }]);
  });

  it("treats number vs numeric string as a type change", () => {
    expect(diffJson({ id: 101 }, { id: "101" })[0]?.kind).toBe("type_changed");
  });

  it("detects changed primitive values in nested objects", () => {
    expect(diffJson({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toEqual([
      { path: "$.a.b.c", kind: "value_changed", baseline: 1, candidate: 2 },
    ]);
  });

  it("compares arrays by index and reports length changes", () => {
    const d = diffJson({ xs: [1, 2, 3] }, { xs: [1, 9] });
    expect(d).toContainEqual({ path: "$.xs", kind: "array_length_changed", baseline: 3, candidate: 2 });
    expect(d).toContainEqual({ path: "$.xs[1]", kind: "value_changed", baseline: 2, candidate: 9 });
    expect(d).toHaveLength(2);
  });

  it("builds bracket paths for keys that aren't identifiers", () => {
    expect(diffJson({ "content-type": "a" }, { "content-type": "b" })[0]?.path).toBe('$["content-type"]');
  });

  it("compares top-level non-object bodies (e.g. plain text)", () => {
    expect(diffJson("ok", "OK")).toEqual([{ path: "$", kind: "value_changed", baseline: "ok", candidate: "OK" }]);
  });

  it("treats NaN as equal to NaN", () => {
    expect(diffJson(Number.NaN, Number.NaN)).toEqual([]);
  });
});
