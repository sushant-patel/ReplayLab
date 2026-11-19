import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises"; // promise-based setTimeout
import { users, type User } from "./data.js";

/**
 * Switches that turn the same code into a "buggy refactor".
 * Baseline = everything off. Candidate = some/all on.
 * Each switch maps to one kind of regression ReplayLab must detect.
 */
export interface Behavior {
  version: string;
  dropAdminRole: boolean; // missing field:  $.role disappears for admin users
  nullEmptyTags: boolean; // type change:    tags [] becomes null
  crashOnMissingUser: boolean; // status change: 404 becomes 500
  sortUsersByName: boolean; // array order:  GET /users ordered by name, not id
  addDisplayName: boolean; // added field:   usually non-breaking, still worth reporting
  perUserDelayMs: number; // latency:       simulated N+1 query in GET /users (0 = off)
}

export const BASELINE_BEHAVIOR: Behavior = {
  version: "1",
  dropAdminRole: false,
  nullEmptyTags: false,
  crashOnMissingUser: false,
  sortUsersByName: false,
  addDisplayName: false,
  perUserDelayMs: 0,
};

// Simulated DB round trip: 2–8 ms with random jitter, identical in both versions.
// Jitter makes latency realistic (non-deterministic) so percentiles mean something,
// while deliberate latency regressions still stand out.
function simulateDbLookup(): Promise<void> {
  return sleep(2 + Math.random() * 6);
}

// Shapes a stored User into the API response according to the active behavior.
function present(user: User, b: Behavior): Record<string, unknown> {
  const out: Record<string, unknown> = { ...user }; // copy: never mutate shared data
  if (b.dropAdminRole && user.role === "admin") delete out.role;
  if (b.nullEmptyTags && user.tags.length === 0) out.tags = null;
  if (b.addDisplayName) out.displayName = `${user.name} (${user.role})`;
  return out;
}

export function buildApp(b: Behavior): FastifyInstance {
  const app = Fastify({
    // LOG_LEVEL=warn during load tests: logging every request to the console costs real time.
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: () => randomUUID(), // unique id per request (default would be req-1, req-2, ...)
  });

  // Runs before every handler: attach headers that identify version + request.
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-api-version", b.version);
    reply.header("x-request-id", request.id);
  });

  // Non-deterministic on purpose: timestamp/requestId differ on EVERY call,
  // and `version` differs between v1/v2 by design. Normalization must handle these.
  app.get("/health", async (request) => ({
    status: "ok",
    version: b.version,
    timestamp: new Date().toISOString(),
    requestId: request.id,
  }));

  app.get<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
    const id = Number(request.params.id); // params always arrive as strings
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: "INVALID_ID", id: request.params.id };
    }

    await simulateDbLookup();
    const user = users.find((u) => u.id === id); // User | undefined

    if (!user) {
      if (b.crashOnMissingUser) {
        // Simulated bug: the "refactor" lost its not-found guard.
        // Fastify catches the thrown error and replies 500 (the request does not hang).
        throw new TypeError("Cannot read properties of undefined (reading 'role')");
      }
      reply.code(404);
      return { error: "USER_NOT_FOUND", id };
    }
    return present(user, b);
  });

  app.get<{ Querystring: { role?: string; limit?: string } }>("/users", async (request) => {
    const { role } = request.query;
    // Clamp limit to 1..100: never trust client input to size your work.
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 10) || 10));

    await simulateDbLookup();
    const filtered = role ? users.filter((u) => u.role === role) : [...users];
    // Array.prototype.sort mutates in place, which is why we sort a copy (filtered is already one).
    if (b.sortUsersByName) filtered.sort((x, y) => x.name.localeCompare(y.name));
    const page = filtered.slice(0, limit);

    // N+1 simulation: the "refactor" fetches each user's details in a separate query.
    if (b.perUserDelayMs > 0) await sleep(b.perUserDelayMs * page.length);

    return { total: filtered.length, users: page.map((u) => present(u, b)) };
  });

  return app;
}

export async function startServer(app: FastifyInstance, port: number): Promise<void> {
  try {
    // 127.0.0.1 = loopback only (not reachable from other machines), and avoids the
    // localhost -> IPv6 ::1 vs IPv4 mismatch.
    await app.listen({ port, host: "127.0.0.1" });
  } catch (err) {
    app.log.error(err);
    process.exit(1); // e.g. EADDRINUSE: port already taken
  }
}
