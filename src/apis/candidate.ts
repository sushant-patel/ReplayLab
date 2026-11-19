// Candidate API (v2): same code as baseline, with selectable deliberate regressions.
//
//   REGRESSIONS=all (default) | none | comma list, e.g. "missing-field,latency"
//   PER_USER_DELAY_MS=10      latency added per returned user when "latency" is on
//
// "none" makes v2 behave like v1 (apart from version/dynamic fields): useful to prove
// ReplayLab reports PASS when nothing is broken (no false positives).
import { BASELINE_BEHAVIOR, buildApp, startServer, type Behavior } from "./app.js";

const ALL_REGRESSIONS = ["missing-field", "type-change", "status", "order", "added-field", "latency"] as const;
type Regression = (typeof ALL_REGRESSIONS)[number]; // union of the array's string literals

function parseRegressions(raw: string | undefined): Set<Regression> {
  if (!raw || raw === "all") return new Set(ALL_REGRESSIONS);
  if (raw === "none") return new Set();
  const names = raw.split(",").map((s) => s.trim());
  for (const name of names) {
    if (!(ALL_REGRESSIONS as readonly string[]).includes(name)) {
      // Fail fast on typos instead of silently running with no regression.
      throw new Error(`Unknown regression "${name}". Valid: ${ALL_REGRESSIONS.join(", ")}, all, none`);
    }
  }
  return new Set(names as Regression[]);
}

const on = parseRegressions(process.env.REGRESSIONS);

const behavior: Behavior = {
  ...BASELINE_BEHAVIOR,
  version: "2",
  dropAdminRole: on.has("missing-field"),
  nullEmptyTags: on.has("type-change"),
  crashOnMissingUser: on.has("status"),
  sortUsersByName: on.has("order"),
  addDisplayName: on.has("added-field"),
  perUserDelayMs: on.has("latency") ? Number(process.env.PER_USER_DELAY_MS ?? 10) : 0,
};

const port = Number(process.env.PORT ?? 3002);
const app = buildApp(behavior);
app.log.info({ regressions: [...on] }, "candidate regressions enabled");
await startServer(app, port);
