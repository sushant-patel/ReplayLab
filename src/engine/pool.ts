// Runs `worker` over all items with at most `limit` in flight. Each lane is a loop that
// takes the next index until none are left, so a slow item only holds up its own lane.

export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>, // should not reject, or Promise.all aborts the batch
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`concurrency must be a positive integer, got ${limit}`);

  const results = new Array<R>(items.length); // indexed, so output order = input order
  let next = 0;

  async function lane(): Promise<void> {
    while (next < items.length) {
      const i = next++; // no await between read and increment, so lanes never share an index
      results[i] = await worker(items[i] as T, i);
    }
  }

  const lanes = Array.from({ length: Math.min(limit, items.length) }, () => lane());
  await Promise.all(lanes);
  return results;
}
