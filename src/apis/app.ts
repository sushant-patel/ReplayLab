import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { users, type User } from "./data.js";

// Switches that turn the same app into a "buggy refactor". Baseline has all of them off;
// each one injects a kind of regression ReplayLab should catch.
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

// Fake DB call, 2-8 ms with jitter (same in both versions) so latency isn't perfectly flat.
function simulateDbLookup(): Promise<void> {
  return sleep(2 + Math.random() * 6);
}

function present(user: User, b: Behavior): Record<string, unknown> {
  const out: Record<string, unknown> = { ...user };
  if (b.dropAdminRole && user.role === "admin") delete out.role;
  if (b.nullEmptyTags && user.tags.length === 0) out.tags = null;
  if (b.addDisplayName) out.displayName = `${user.name} (${user.role})`;
  return out;
}

export function buildApp(b: Behavior): FastifyInstance {
  const app = Fastify({
    // per-request logging is slow under load; LOG_LEVEL=warn for benchmarks
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: () => randomUUID(),
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-api-version", b.version);
    reply.header("x-request-id", request.id);
  });

  // timestamp/requestId change on every call and version differs between v1 and v2:
  // these are what the ignore rules exist for.
  app.get("/health", async (request) => ({
    status: "ok",
    version: b.version,
    timestamp: new Date().toISOString(),
    requestId: request.id,
  }));

  app.get<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: "INVALID_ID", id: request.params.id };
    }

    await simulateDbLookup();
    const user = users.find((u) => u.id === id);

    if (!user) {
      if (b.crashOnMissingUser) {
        // the "refactor" lost its not-found guard; Fastify turns the throw into a 500
        throw new TypeError("Cannot read properties of undefined (reading 'role')");
      }
      reply.code(404);
      return { error: "USER_NOT_FOUND", id };
    }
    return present(user, b);
  });

  app.get<{ Querystring: { role?: string; limit?: string } }>("/users", async (request) => {
    const { role } = request.query;
    // clamp to 1..100
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 10) || 10));

    await simulateDbLookup();
    const filtered = role ? users.filter((u) => u.role === role) : [...users];
    if (b.sortUsersByName) filtered.sort((x, y) => x.name.localeCompare(y.name));
    const page = filtered.slice(0, limit);

    // simulated N+1: one extra "query" per returned user
    if (b.perUserDelayMs > 0) await sleep(b.perUserDelayMs * page.length);

    return { total: filtered.length, users: page.map((u) => present(u, b)) };
  });

  return app;
}

export async function startServer(app: FastifyInstance, port: number): Promise<void> {
  try {
    // 127.0.0.1 rather than localhost: loopback only, and no ::1 vs IPv4 surprises
    await app.listen({ port, host: "127.0.0.1" });
  } catch (err) {
    app.log.error(err);
    process.exit(1); // usually EADDRINUSE
  }
}
