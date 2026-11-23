// Single self-contained HTML file (inline CSS, no JS or CDN) so it works as a CI artifact offline.
import type { Comparison, Finding } from "../compare/compare.js";
import type { LatencyStats } from "../metrics/stats.js";
import type { RunResult } from "../run.js";
import type { HttpResult } from "../replay/types.js";

// Everything from a response body gets escaped: it can contain markup.
export function escapeHtml(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "undefined";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const ms = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? "–" : `${v.toFixed(1)} ms`);

function statsRow(label: string, s: LatencyStats | null): string {
  if (!s) return `<tr><td>${label}</td><td colspan="6">no successful responses</td></tr>`;
  return `<tr><td>${label}</td><td>${s.count}</td><td>${ms(s.p50)}</td><td>${ms(s.p95)}</td><td>${ms(s.p99)}</td><td>${ms(s.mean)}</td><td>${ms(s.max)}</td></tr>`;
}

function side(r: HttpResult): string {
  return r.kind === "response" ? `${r.status} · ${ms(r.latencyMs)}` : `<span class="bad">${r.errorType}</span> · ${ms(r.latencyMs)}`;
}

function describeFinding(f: Finding): string {
  const label: Record<Finding["kind"], string> = {
    missing_field: "Missing field",
    added_field: "Added field",
    type_changed: "Type changed",
    value_changed: "Value changed",
    array_length_changed: "Array length changed",
    status_changed: "Status changed",
    header_changed: "Header changed",
    request_failed: "Request failed",
  };
  const values =
    f.kind === "missing_field"
      ? `baseline: <code>${escapeHtml(f.baseline)}</code>`
      : f.kind === "added_field"
        ? `candidate: <code>${escapeHtml(f.candidate)}</code>`
        : `<code>${escapeHtml(f.baseline)}</code> → <code>${escapeHtml(f.candidate)}</code>`;
  return `<li class="${f.severity}"><b>${label[f.kind]}</b> <code>${escapeHtml(f.path)}</code> ${values}</li>`;
}

function bodyOf(r: HttpResult): string {
  return r.kind === "response" ? escapeHtml(r.body) : escapeHtml(`${r.errorType}: ${r.message}`);
}

function requestRow(c: Comparison): string {
  const { request, baseline, candidate } = c.pair;
  const findings = c.findings.length ? `<ul>${c.findings.map(describeFinding).join("")}</ul>` : "<p>No differences.</p>";
  return `
<details class="req ${c.verdict}">
  <summary><span class="pill ${c.verdict}">${c.verdict.toUpperCase()}</span>
    <code>${escapeHtml(request.method)} ${escapeHtml(request.path)}</code>
    <span class="muted">${escapeHtml(request.id)} · baseline ${side(baseline)} · candidate ${side(candidate)} · ${c.findings.length} finding(s)</span>
  </summary>
  ${findings}
  <div class="bodies">
    <div><h4>Baseline</h4><pre>${bodyOf(baseline)}</pre></div>
    <div><h4>Candidate</h4><pre>${bodyOf(candidate)}</pre></div>
  </div>
</details>`;
}

export function renderReport({ summary: s, comparisons }: RunResult): string {
  // Failures first: the reader opens the report to see what broke.
  const order = { fail: 0, error: 1, pass: 2 } as const;
  const sorted = [...comparisons].sort((a, b) => order[a.verdict] - order[b.verdict]);

  const routeRows = s.routes
    .map(
      (r) => `<tr class="${r.regressed ? "fail" : ""}"><td><code>${escapeHtml(r.route)}</code></td>
      <td>${r.baseline?.count ?? 0}</td><td>${ms(r.baseline?.p50)}</td><td>${ms(r.candidate?.p50)}</td>
      <td>${ms(r.baseline?.p95)}</td><td>${ms(r.candidate?.p95)}</td>
      <td>${r.p95DeltaPct === null ? "–" : `${r.p95DeltaPct >= 0 ? "+" : ""}${r.p95DeltaPct.toFixed(0)}%`}</td>
      <td>${r.regressed ? '<span class="pill fail">REGRESSED</span>' : "ok"}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ReplayLab Report</title>
<style>
  :root { --bg:#f7f7f8; --card:#fff; --text:#1d1d1f; --muted:#6b6b76; --line:#e3e3e8;
          --pass:#1a7f37; --fail:#cf222e; --error:#9a6700; --warn:#bf8700; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111214; --card:#1b1c1f; --text:#e8e8ea; --muted:#9a9aa5; --line:#2c2d31;
          --pass:#3fb950; --fail:#f85149; --error:#d29922; --warn:#d29922; } }
  * { box-sizing:border-box } body { margin:0; padding:24px 16px; font:14px/1.5 system-ui,sans-serif; background:var(--bg); color:var(--text) }
  main { max-width:1100px; margin:0 auto } h1 { margin:0 0 4px } .muted { color:var(--muted) }
  .banner { padding:16px; border-radius:10px; color:#fff; margin:16px 0; font-weight:600 }
  .banner.pass { background:var(--pass) } .banner.fail { background:var(--fail) } .banner ul { margin:8px 0 0; font-weight:400 }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:16px 0 }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px }
  .card b { display:block; font-size:22px }
  section { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin:16px 0; overflow-x:auto }
  table { border-collapse:collapse; width:100% } th,td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--line); white-space:nowrap }
  tr.fail td { color:var(--fail) }
  .pill { display:inline-block; padding:1px 8px; border-radius:99px; font-size:12px; font-weight:700; color:#fff }
  .pill.pass { background:var(--pass) } .pill.fail { background:var(--fail) } .pill.error { background:var(--error) }
  details.req { border-top:1px solid var(--line); padding:8px 0 } details.req summary { cursor:pointer; display:flex; gap:10px; flex-wrap:wrap; align-items:center }
  li.breaking { color:var(--fail) } li.warning { color:var(--warn) } .bad { color:var(--fail); font-weight:600 }
  .bodies { display:grid; grid-template-columns:1fr 1fr; gap:12px } @media (max-width:700px) { .bodies { grid-template-columns:1fr } }
  pre { background:var(--bg); border:1px solid var(--line); padding:10px; border-radius:8px; overflow:auto; max-height:300px; font-size:12px }
  code { font-family:ui-monospace,Consolas,monospace }
</style></head>
<body><main>
<h1>ReplayLab Regression Report</h1>
<p class="muted">${escapeHtml(s.startedAt)} · baseline <code>${escapeHtml(s.baselineUrl)}</code> vs candidate <code>${escapeHtml(s.candidateUrl)}</code> · concurrency ${s.concurrency}</p>

<div class="banner ${s.gate.passed ? "pass" : "fail"}">${s.gate.passed ? "✔ PASS: no regressions detected" : "✖ FAIL: regressions detected"}
${s.gate.reasons.length ? `<ul>${s.gate.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : ""}</div>

<div class="cards">
  <div class="card"><span class="muted">Requests</span><b>${s.totals.requests}</b></div>
  <div class="card"><span class="muted">Passed</span><b style="color:var(--pass)">${s.totals.passed}</b></div>
  <div class="card"><span class="muted">Regressed</span><b style="color:var(--fail)">${s.totals.failed}</b></div>
  <div class="card"><span class="muted">Not judged</span><b style="color:var(--error)">${s.totals.errored}</b></div>
  <div class="card"><span class="muted">Throughput</span><b>${s.throughputPairsPerSec.toFixed(1)}/s</b></div>
  <div class="card"><span class="muted">Candidate errors</span><b>${s.errorRatePct.candidate.toFixed(1)}%</b></div>
</div>

<section><h2>Latency (all requests)</h2>
<table><tr><th></th><th>n</th><th>p50</th><th>p95</th><th>p99</th><th>mean</th><th>max</th></tr>
${statsRow("Baseline", s.latency.baseline)}${statsRow("Candidate", s.latency.candidate)}</table></section>

<section><h2>Latency by route</h2>
<table><tr><th>Route</th><th>n</th><th>p50 base</th><th>p50 cand</th><th>p95 base</th><th>p95 cand</th><th>Δ p95</th><th></th></tr>${routeRows}</table></section>

<section><h2>Requests</h2>${sorted.map(requestRow).join("")}</section>
</main></body></html>`;
}
