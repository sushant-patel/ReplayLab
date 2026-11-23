// Structural JSON diff. Walks both values together and reports each difference with a
// JSONPath-ish location like "$.users[0].role". Linear in the number of nodes.

export type JsonType = "null" | "array" | "object" | "string" | "number" | "boolean" | "undefined";

export type DiffKind = "missing_field" | "added_field" | "type_changed" | "value_changed" | "array_length_changed";

export interface Difference {
  path: string;
  kind: DiffKind;
  baseline?: unknown; // absent for added_field
  candidate?: unknown; // absent for missing_field
}

// typeof alone can't tell null or arrays apart from objects.
export function jsonType(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as JsonType;
}

// $.name for identifiers, $["content-type"] for everything else
function childPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

export function diffJson(baseline: unknown, candidate: unknown, path = "$", out: Difference[] = []): Difference[] {
  const tb = jsonType(baseline);
  const tc = jsonType(candidate);

  // Report a type change once and stop; diffing the inside of [] vs null is just noise.
  if (tb !== tc) {
    out.push({ path, kind: "type_changed", baseline, candidate });
    return out;
  }

  if (tb === "object") {
    const b = baseline as Record<string, unknown>;
    const c = candidate as Record<string, unknown>;
    for (const key of Object.keys(b)) {
      const p = childPath(path, key);
      if (!Object.hasOwn(c, key)) out.push({ path: p, kind: "missing_field", baseline: b[key] });
      else diffJson(b[key], c[key], p, out);
    }
    for (const key of Object.keys(c)) {
      if (!Object.hasOwn(b, key)) out.push({ path: childPath(path, key), kind: "added_field", candidate: c[key] });
    }
    return out;
  }

  // Arrays are compared by index, so a reordered list shows up as many value changes.
  // TODO: optionally match elements by a key field (e.g. "id").
  if (tb === "array") {
    const b = baseline as unknown[];
    const c = candidate as unknown[];
    if (b.length !== c.length) {
      out.push({ path, kind: "array_length_changed", baseline: b.length, candidate: c.length });
    }
    const shared = Math.min(b.length, c.length);
    for (let i = 0; i < shared; i++) diffJson(b[i], c[i], `${path}[${i}]`, out);
    return out;
  }

  // Object.is so NaN equals NaN
  if (!Object.is(baseline, candidate)) out.push({ path, kind: "value_changed", baseline, candidate });
  return out;
}
