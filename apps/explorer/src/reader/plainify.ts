// Convert the reader's mixed Arrow / class / bigint shapes into plain,
// JSON-friendly POJOs so the UI tree view and React state never touch a Vector
// or a bigint. Defensive by design — this is a system boundary that handles
// metadata from untrusted, possibly-malformed user files.

const MAX_DEPTH = 14; // guard against pathological cycles
const MAX_ARRAY = 4096; // cap materialized arrays so metadata can't exhaust memory
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
// Keys that would corrupt the prototype chain if assigned to a plain object.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function plainBigInt(v: bigint): number | string {
  // Preserve precision beyond the safe-integer range as a string rather than
  // silently rounding via Number().
  return v >= -MAX_SAFE && v <= MAX_SAFE ? Number(v) : v.toString();
}

function plainArray(items: ArrayLike<unknown>, depth: number): unknown[] {
  const n = Math.min(items.length, MAX_ARRAY);
  const out: unknown[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = plainify(items[i], depth + 1);
  if (items.length > MAX_ARRAY) out.push(`…(+${items.length - MAX_ARRAY} more)`);
  return out;
}

export function plainify(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return plainBigInt(value);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth > MAX_DEPTH) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return plainArray(value, depth);
  if (ArrayBuffer.isView(value)) {
    return plainArray(value as unknown as ArrayLike<number>, depth);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (UNSAFE_KEYS.has(k) || typeof v === "function") continue;
      const pv = plainify(v, depth + 1);
      if (pv !== undefined) out[k] = pv;
    }
    return out;
  }
  return undefined;
}
