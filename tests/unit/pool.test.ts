import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { runPool } from "../../src/engine/pool.js";

describe("runPool", () => {
  it("never runs more than `limit` tasks at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(Array.from({ length: 50 }, (_, i) => i), 5, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(Math.random() * 5);
      inFlight--;
    });
    expect(peak).toBe(5);
  });

  it("returns results in INPUT order even when tasks finish out of order", async () => {
    const results = await runPool([30, 1, 20, 5], 4, async (ms) => {
      await sleep(ms);
      return ms;
    });
    expect(results).toEqual([30, 1, 20, 5]);
  });

  it("is faster than sequential for I/O-bound work", async () => {
    const t0 = performance.now();
    await runPool(Array.from({ length: 10 }, () => 0), 10, () => sleep(50));
    expect(performance.now() - t0).toBeLessThan(250); // sequential would be >= 500 ms
  });

  it("handles more lanes than items and empty input", async () => {
    expect(await runPool([1, 2], 10, async (x) => x * 2)).toEqual([2, 4]);
    expect(await runPool([], 3, async (x) => x)).toEqual([]);
  });

  it("rejects an invalid limit", async () => {
    await expect(runPool([1], 0, async (x) => x)).rejects.toThrow(/positive integer/);
  });
});
