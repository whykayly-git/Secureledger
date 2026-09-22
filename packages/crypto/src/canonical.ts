/**
 * Deterministic canonical serialization used on both sides of the hash chain
 * (the web app's inline hashing and the worker's Merkle/checkpoint logic).
 * Object keys are sorted recursively so the same logical record always
 * produces the same byte string regardless of property insertion order.
 */
export function canonicalize(value: unknown): string {
  return serialize(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  // Prisma.Decimal and similar numeric wrappers serialize to their exact string form
  if (typeof value === "object" && value !== null && (value as any).constructor?.name === "Decimal") {
    return (value as any).toString();
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, normalize(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const parts = Object.keys(obj).map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}
