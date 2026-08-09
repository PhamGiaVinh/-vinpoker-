import { canonicalize, sha256Hex } from "./provenanceHash";

export const DECISION_PACKET_HASH_CONTRACT_VERSION = "series-canonical-json-v1" as const;
export const D2A_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export type D2ACanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly D2ACanonicalValue[]
  | { readonly [key: string]: D2ACanonicalValue };

export interface D2ACanonicalHash {
  readonly canonicalText: string;
  readonly utf8ByteLength: number;
  readonly sha256: string;
}

export class DecisionPacketCanonicalError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "DecisionPacketCanonicalError";
    this.code = code;
  }
}

const MACHINE_KEY = /^[A-Za-z][A-Za-z0-9]*$/;

function fail(message: string, code: string): never {
  throw new DecisionPacketCanonicalError(message, code);
}

function hasDisallowedControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 127) return true;
    if (code <= 31 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

function normalizeMachineKey(raw: string, path: string): string {
  const key = raw.normalize("NFC").trim();
  if (!MACHINE_KEY.test(key)) {
    fail(`${path} must use an ASCII machine key`, "INVALID_CANONICAL_KEY");
  }
  return key;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Normalize an approved D2A text value before it enters a semantic payload. */
export function normalizeDecisionPacketText(raw: string, label: string, maxLength = 4096): string {
  if (typeof raw !== "string") fail(`${label} must be text`, "INVALID_TEXT");
  const value = raw.normalize("NFC").trim();
  if (value.length === 0 || value.length > maxLength || hasDisallowedControl(value)) {
    fail(`${label} must be non-blank bounded text`, "INVALID_TEXT");
  }
  return value;
}

/** Bytewise UTF-8 ordering is explicit so TypeScript and PostgreSQL C collation share set ordering. */
export function compareDecisionPacketUtf8(left: string, right: string): number {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index] - rightBytes[index];
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

/** Normalizes a semantically set-like text list while preserving no ambient locale dependency. */
export function normalizeDecisionPacketTextSet(
  raw: readonly string[],
  label: string,
  maxLength = 2048,
): readonly string[] {
  if (!Array.isArray(raw)) fail(`${label} must be an array`, "INVALID_LIST");
  const values = raw.map((value, index) => normalizeDecisionPacketText(value, `${label}[${index}]`, maxLength));
  const sorted = [...values].sort(compareDecisionPacketUtf8);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      fail(`${label} contains a duplicate`, "DUPLICATE_LIST_MEMBER");
    }
  }
  return deepFreeze(sorted);
}

/**
 * The D2A payload domain is deliberately narrower than generic provenance hashing:
 * object keys are ASCII machine keys, numbers are non-negative safe integers, and
 * string values are NFC-normalized before both runtimes serialize them.
 */
export function normalizeDecisionPacketCanonicalValue(value: unknown, path = "value"): D2ACanonicalValue {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.normalize("NFC").trim();
    if (hasDisallowedControl(normalized)) fail(`${path} contains a disallowed control`, "INVALID_CANONICAL_TEXT");
    return normalized;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail(`${path} must be a non-negative safe integer`, "INVALID_CANONICAL_NUMBER");
    }
    return value === 0 ? 0 : value;
  }
  if (Array.isArray(value)) {
    return deepFreeze(value.map((entry, index) => normalizeDecisionPacketCanonicalValue(entry, `${path}[${index}]`)));
  }
  if (typeof value !== "object" || value === undefined) {
    fail(`${path} is not a supported canonical value`, "INVALID_CANONICAL_VALUE");
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    fail(`${path} must be a plain object`, "INVALID_CANONICAL_OBJECT");
  }
  const normalized: Record<string, D2ACanonicalValue> = {};
  const seen = new Set<string>();
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const nfcKey = rawKey.normalize("NFC").trim();
    if (seen.has(nfcKey)) fail(`${path} has a duplicate key after NFC normalization`, "DUPLICATE_KEY_AFTER_NFC");
    seen.add(nfcKey);
    const key = normalizeMachineKey(rawKey, `${path}.${rawKey}`);
    normalized[key] = normalizeDecisionPacketCanonicalValue(rawValue, `${path}.${key}`);
  }
  return deepFreeze(normalized);
}

export function canonicalizeDecisionPacketV1(value: unknown): string {
  return canonicalize(normalizeDecisionPacketCanonicalValue(value));
}

export async function hashDecisionPacketV1(value: unknown): Promise<D2ACanonicalHash> {
  const canonicalText = canonicalizeDecisionPacketV1(value);
  return deepFreeze({
    canonicalText,
    utf8ByteLength: new TextEncoder().encode(canonicalText).byteLength,
    sha256: await sha256Hex(canonicalText),
  });
}
