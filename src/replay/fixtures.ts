import { readFile } from "node:fs/promises";
import type { ReplayRequest } from "./types.js";

export async function loadFixtures(file: string): Promise<ReplayRequest[]> {
  const data: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(data)) throw new Error(`${file}: expected a JSON array of requests`);

  const seenIds = new Set<string>();
  return data.map((item: unknown, i): ReplayRequest => {
    const where = `${file}[${i}]`;
    if (typeof item !== "object" || item === null) throw new Error(`${where}: expected an object`);
    const { id, method, path, headers } = item as Record<string, unknown>;

    if (typeof id !== "string" || id === "") throw new Error(`${where}: "id" must be a non-empty string`);
    if (typeof path !== "string" || !path.startsWith("/")) throw new Error(`${where} (${id}): "path" must start with "/"`);
    // Replaying writes would repeat their side effects, so anything but GET is rejected.
    if (method !== "GET") throw new Error(`${where} (${id}): only GET is allowed, got ${String(method)}`);
    if (seenIds.has(id)) throw new Error(`${where}: duplicate id "${id}"`);
    seenIds.add(id);

    return { id, method, path, headers: (headers ?? {}) as Record<string, string> };
  });
}
