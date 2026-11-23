// Ignore rules for fields that are expected to differ (timestamps, request ids, ...).
//   "$.timestamp"             that field
//   "$.users[*].displayName"  that field in every element
//   "$.meta"                  that field and everything under it
// Differences are filtered after diffing rather than stripping fields before, so the raw
// bodies stay intact for the report and a rule only ever hides the paths it matches.

export function compilePattern(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\[\\\*\\\]/g, "\\[\\d+\\]"); // [*] -> any index
  // exact path, or something nested under it
  return new RegExp(`^${escaped}(?:$|[.\\[])`);
}

export class IgnoreRules {
  private readonly regexes: RegExp[];

  constructor(patterns: readonly string[]) {
    this.regexes = patterns.map(compilePattern);
  }

  matches(path: string): boolean {
    return this.regexes.some((re) => re.test(path));
  }

  filter<T extends { path: string }>(differences: T[]): T[] {
    return differences.filter((d) => !this.matches(d.path));
  }
}
