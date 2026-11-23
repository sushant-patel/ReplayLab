import { describe, expect, it } from "vitest";
import { percentile, routeKey, summarize } from "../../src/metrics/stats.js";

describe("percentile (nearest rank)", () => {
  const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);

  it("returns the expected ranks for 1..100", () => {
    expect(percentile(oneToHundred, 50)).toBe(50);
    expect(percentile(oneToHundred, 95)).toBe(95);
    expect(percentile(oneToHundred, 99)).toBe(99);
    expect(percentile(oneToHundred, 100)).toBe(100);
  });

  it("handles tiny samples (p99 of 3 values is the max)", () => {
    expect(percentile([10, 20, 30], 99)).toBe(30);
    expect(percentile([10, 20, 30], 50)).toBe(20);
  });

  it("returns NaN for an empty sample", () => {
    expect(percentile([], 50)).toBeNaN();
  });
});

describe("summarize", () => {
  it("sorts numerically, not lexicographically", () => {
    // Default .sort() would order these as [100, 25, 3] (string comparison).
    const s = summarize([100, 3, 25]);
    expect(s?.min).toBe(3);
    expect(s?.max).toBe(100);
    expect(s?.p50).toBe(25);
  });

  it("shows why the mean misleads: one outlier drags it, p50 ignores it", () => {
    const s = summarize([10, 10, 10, 10, 10, 10, 10, 10, 10, 1000]);
    expect(s?.p50).toBe(10);
    expect(s?.mean).toBe(109);
  });

  it("returns null for no samples", () => {
    expect(summarize([])).toBeNull();
  });
});

describe("routeKey", () => {
  it("groups numeric ids and drops query strings", () => {
    expect(routeKey("/users/101")).toBe("/users/:id");
    expect(routeKey("/users?role=admin&limit=2")).toBe("/users");
    expect(routeKey("/health")).toBe("/health");
  });
});
