import type { PairResult } from "../replay/types.js";
import { diffJson, type DiffKind } from "./diff.js";
import type { IgnoreRules } from "./ignore.js";

export type FindingKind = DiffKind | "status_changed" | "header_changed" | "request_failed";
export type Severity = "breaking" | "warning";

export interface Finding {
  kind: FindingKind;
  path: string; // "$.role", "status", "headers.content-type", "candidate"
  severity: Severity;
  baseline?: unknown;
  candidate?: unknown;
}

// pass:  no breaking findings (warnings are fine)
// fail:  the candidate regressed, or failed where the baseline answered
// error: the baseline itself failed, so there is nothing to compare against
export type Verdict = "pass" | "fail" | "error";

export interface Comparison {
  pair: PairResult;
  verdict: Verdict;
  findings: Finding[];
}

export interface CompareOptions {
  ignore: IgnoreRules;
  compareHeaders: readonly string[]; // lower-case
  addedFieldsAreBreaking: boolean;
}

export function comparePair(pair: PairResult, opts: CompareOptions): Comparison {
  const { baseline: b, candidate: c } = pair;

  if (b.kind === "error") {
    return {
      pair,
      verdict: "error",
      findings: [{ kind: "request_failed", path: "baseline", severity: "breaking", baseline: `${b.errorType}: ${b.message}` }],
    };
  }
  if (c.kind === "error") {
    return {
      pair,
      verdict: "fail",
      findings: [{ kind: "request_failed", path: "candidate", severity: "breaking", candidate: `${c.errorType}: ${c.message}` }],
    };
  }

  const findings: Finding[] = [];

  if (b.status !== c.status) {
    findings.push({ kind: "status_changed", path: "status", severity: "breaking", baseline: b.status, candidate: c.status });
  }

  // Only configured headers; most (date, x-request-id, content-length) change on every call.
  for (const name of opts.compareHeaders) {
    if (b.headers[name] !== c.headers[name]) {
      findings.push({ kind: "header_changed", path: `headers.${name}`, severity: "breaking", baseline: b.headers[name], candidate: c.headers[name] });
    }
  }

  for (const d of opts.ignore.filter(diffJson(b.body, c.body))) {
    const severity: Severity = d.kind === "added_field" && !opts.addedFieldsAreBreaking ? "warning" : "breaking";
    findings.push({ ...d, severity });
  }

  return { pair, verdict: findings.some((f) => f.severity === "breaking") ? "fail" : "pass", findings };
}
