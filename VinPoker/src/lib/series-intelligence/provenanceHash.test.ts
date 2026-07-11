// B2 - canonical serializer + content hash. Locks: key-order invariance, NFC, -0->0, bigint->decimal string,
// reject non-finite/undefined/non-plain-objects, detect a post-NFC key collision, and a known SHA-256 vector.
import { describe, it, expect } from "vitest";
import { canonicalize, canonicalHash, sha256Hex, shortHash, ProvenanceError } from "./provenanceHash";

// Pure-ASCII source: precomposed e-acute (U+00E9) vs its decomposed form (U+0065 U+0301). Same NFC form,
// genuinely different code points (so they are two distinct JS object keys).
const COMPOSED = "é";
const DECOMPOSED = COMPOSED.normalize("NFD");

describe("B2 canonicalize", () => {
  it("is object-key-order invariant (recursively)", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ x: { q: 1, p: 2 }, y: 3 })).toBe(canonicalize({ y: 3, x: { p: 2, q: 1 } }));
  });
  it("preserves array order", () => {
    expect(canonicalize([1, 2, 3])).toBe("[1,2,3]");
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });
  it("NFC-normalizes string values (composed == decomposed)", () => {
    expect(COMPOSED).not.toBe(DECOMPOSED); // distinct code points
    expect(canonicalize({ k: COMPOSED })).toBe(canonicalize({ k: DECOMPOSED }));
  });
  it("collapses -0 to 0 and distinguishes number from string", () => {
    expect(canonicalize(-0)).toBe("0");
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize(5)).toBe("5");
    expect(canonicalize("5")).toBe('"5"');
    expect(canonicalize(5)).not.toBe(canonicalize("5"));
  });
  it("encodes bigint as a canonical decimal string (never a JS number)", () => {
    expect(canonicalize(5000000000n)).toBe('"5000000000"');
    expect(canonicalize({ gtd: 9007199254740993n })).toBe('{"gtd":"9007199254740993"}'); // beyond MAX_SAFE_INTEGER
  });
  it("serializes null and booleans", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize({ a: null, b: true, c: false })).toBe('{"a":null,"b":true,"c":false}');
  });
  it("rejects non-finite numbers and undefined", () => {
    expect(() => canonicalize(NaN)).toThrow(ProvenanceError);
    expect(() => canonicalize(Infinity)).toThrow(ProvenanceError);
    expect(() => canonicalize(-Infinity)).toThrow(ProvenanceError);
    expect(() => canonicalize(undefined)).toThrow(ProvenanceError);
    expect(() => canonicalize({ a: undefined })).toThrow(ProvenanceError);
    expect(() => canonicalize([1, NaN])).toThrow(ProvenanceError);
  });
  it("rejects non-plain objects (Date/Map/Set/class) instead of silently emitting empty object", () => {
    expect(() => canonicalize(new Date())).toThrow(ProvenanceError);
    expect(() => canonicalize(new Map())).toThrow(ProvenanceError);
    expect(() => canonicalize(new Set())).toThrow(ProvenanceError);
    expect(() => canonicalize({ a: new Date() })).toThrow(ProvenanceError); // nested
    expect(canonicalize(Object.create(null))).toBe("{}"); // null-prototype record still allowed
  });
  it("rejects a post-NFC key collision (two distinct keys that normalize to the same string)", () => {
    const collide: Record<string, number> = { [COMPOSED]: 1, [DECOMPOSED]: 2 };
    expect(Object.keys(collide).length).toBe(2); // genuinely two distinct own keys
    let code: string | undefined;
    try {
      canonicalize(collide);
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe("DUPLICATE_KEY_AFTER_NFC");
  });
});

describe("B2 sha256Hex / canonicalHash", () => {
  it("matches the known SHA-256 vectors", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("same semantic value gives the same hash regardless of key order", async () => {
    expect(await canonicalHash({ b: 1, a: 2 })).toBe(await canonicalHash({ a: 2, b: 1 }));
  });
  it("a changed value gives a different hash", async () => {
    expect(await canonicalHash({ a: 1 })).not.toBe(await canonicalHash({ a: 2 }));
  });
  it("shortHash takes a prefix", () => {
    expect(shortHash("abcdef0123456789")).toBe("abcdef01");
    expect(shortHash("abcdef0123456789", 4)).toBe("abcd");
  });
});
