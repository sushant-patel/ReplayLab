export interface LatencyStats {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

// Nearest-rank on an ascending array: rank = ceil(p/100 * n), so the result is always a
// real sample (no interpolation). n = 20, p95 -> rank 19 -> sorted[18].
export function percentile(sorted: readonly number[], p: number): number {

  if(sorted.length === 0) return Number.NaN ;
  const rank  = Math.ceil((p/100) * sorted.length) ;
  const index = Math.min(sorted.length, Math.max(1,rank)) - 1 ;
  return sorted[index] as number;
}

export function summarize(values: readonly number[]): LatencyStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b); // default sort is lexicographic
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    min: sorted[0] as number,
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] as number,
  };
}

// "/users/101?x=1" -> "/users/:id"
export function routeKey(path: string): string {
  const pathname = path.split("?")[0] ?? path;
  return pathname
    .split("/")
    .map((segment) => (/^\d+$/.test(segment) ? ":id" : segment))
    .join("/");
}
