// Series Intelligence — canonical serialization + content hashing (B2, part 1).
//
// The ONE deterministic serializer for content-addressed forecast provenance. Same semantic value ⇒ same
// canonical string ⇒ same SHA-256, regardless of JSON key order. Hardened for JS↔Postgres round-trips
// (RFC-8785-adjacent):
//   • object keys sorted (recursive); arrays keep their order
//   • strings Unicode-NFC normalized (keys too)
//   • finite numbers only (NaN/±Infinity rejected); -0 collapses to 0
//   • bigint ⇒ canonical DECIMAL STRING (never lossily coerced to a JS number)
//   • undefined rejected (not serializable)
// Callers that carry money/counts (DB bigint) MUST pass them as decimal strings so a `bigint` value and its
// JS-number twin never diverge — this module keeps a string a string and a bigint a decimal string.
//
// Reuses the same crypto.subtle SHA-256 primitive as hashPlayerRef.ts (byte-identical to the server digest),
// generalized to hash any UTF-8 string.

/** Thrown when a value cannot be canonically serialized (non-finite number, undefined, unsupported type). */
export class ProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceError";
  }
}

const jstr = (s: string): string => JSON.stringify(s.normalize("NFC")); // NFC-normalized, JSON-escaped, quoted

function serNumber(n: number): string {
  if (!Number.isFinite(n)) throw new ProvenanceError(`non-finite number is not serializable: ${n}`);
  return String(n === 0 ? 0 : n); // collapse -0 → 0; shortest round-trippable decimal
}

function ser(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) throw new ProvenanceError("undefined is not serializable");
  const t = typeof v;
  if (t === "string") return jstr(v as string);
  if (t === "boolean") return (v as boolean) ? "true" : "false";
  if (t === "number") return serNumber(v as number);
  if (t === "bigint") return jstr((v as bigint).toString()); // canonical decimal string, never a JS number
  if (Array.isArray(v)) return "[" + v.map(ser).join(",") + "]";
  if (t === "object") {
    // Only PLAIN objects (or null-prototype records). A Date/Map/Set/RegExp/class instance would otherwise
    // serialize to "{}" and silently lose its data — fail closed instead (this primitive is B1's foundation).
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      throw new ProvenanceError("only plain objects are serializable (got a non-plain object, e.g. Date/Map/Set/class instance)");
    }
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => jstr(k) + ":" + ser(obj[k])).join(",") + "}";
  }
  throw new ProvenanceError(`unsupported type for canonical serialization: ${t}`);
}

/** Deterministic canonical string for a value. Key-order-independent; NFC strings; -0→0; bigint→decimal. */
export function canonicalize(value: unknown): string {
  return ser(value);
}

/** SHA-256 hex of a UTF-8 string (same primitive as hashPlayerRef, generalized). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 hex over the canonical serialization of a value (the content-address of a semantic input). */
export async function canonicalHash(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}

/** A short prefix of a hex digest for compact display (never for identity/joins). */
export function shortHash(hex: string, n = 8): string {
  return hex.slice(0, n);
}
