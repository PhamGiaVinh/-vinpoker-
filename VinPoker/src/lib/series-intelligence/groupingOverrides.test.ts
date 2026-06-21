import { describe, it, expect, beforeEach } from "vitest";
import {
  emptyOverrides,
  isSafeKey,
  makeManualLabel,
  mergeUnderLabel,
  resetKeys,
  clearOverrides,
  pruneOverrides,
  validateOverrides,
  loadOverrides,
  saveOverrides,
  clearStoredOverrides,
  GROUPING_OVERRIDES_STORAGE_KEY,
  GROUPING_OVERRIDES_VERSION,
  MANUAL_LABEL_PREFIX,
} from "./groupingOverrides";

describe("makeManualLabel", () => {
  it("is deterministic (smallest obsKey, prefixed) regardless of order", () => {
    const a = makeManualLabel(["s2::csv-1", "s1::csv-3", "s1::csv-1"]);
    const b = makeManualLabel(["s1::csv-1", "s2::csv-1", "s1::csv-3"]);
    expect(a).toBe(b);
    expect(a.startsWith(MANUAL_LABEL_PREFIX)).toBe(true);
  });
});

describe("reducers", () => {
  it("mergeUnderLabel assigns all keys the same label", () => {
    const o = mergeUnderLabel(emptyOverrides(), ["k1", "k2"], "manual::x");
    expect(o.labels).toEqual({ k1: "manual::x", k2: "manual::x" });
  });

  it("mergeUnderLabel ignores empty selection / empty label", () => {
    expect(mergeUnderLabel(emptyOverrides(), [], "manual::x").labels).toEqual({});
    expect(mergeUnderLabel(emptyOverrides(), ["k1"], "").labels).toEqual({});
  });

  it("resetKeys drops only the given keys; same ref when nothing changes", () => {
    const o = mergeUnderLabel(emptyOverrides(), ["k1", "k2"], "manual::x");
    expect(resetKeys(o, ["k1"]).labels).toEqual({ k2: "manual::x" });
    expect(resetKeys(o, ["nope"])).toBe(o); // unchanged → same reference
  });

  it("clearOverrides → empty", () => {
    expect(clearOverrides()).toEqual({ version: GROUPING_OVERRIDES_VERSION, labels: {} });
  });

  it("pruneOverrides drops orphan keys; same ref when all valid", () => {
    const o = mergeUnderLabel(emptyOverrides(), ["k1", "k2"], "manual::x");
    expect(pruneOverrides(o, new Set(["k1"])).labels).toEqual({ k1: "manual::x" });
    expect(pruneOverrides(o, new Set(["k1", "k2"]))).toBe(o); // unchanged → same ref
  });
});

describe("validateOverrides — rehydrate safety", () => {
  it("round-trips a valid envelope", () => {
    const env = { version: GROUPING_OVERRIDES_VERSION, labels: { "s1::csv-1": "manual::x" } };
    expect(validateOverrides(JSON.parse(JSON.stringify(env)))).toEqual(env);
  });

  it("wrong version / non-object → empty (never throws)", () => {
    expect(validateOverrides({ version: 9, labels: { a: "b" } })).toEqual(emptyOverrides());
    expect(validateOverrides(null)).toEqual(emptyOverrides());
    expect(validateOverrides([1, 2])).toEqual(emptyOverrides());
  });

  it("drops non-string / empty label values; keeps valid", () => {
    const out = validateOverrides({
      version: GROUPING_OVERRIDES_VERSION,
      labels: { good: "manual::x", empty: "", num: 5, obj: {} },
    });
    expect(out.labels).toEqual({ good: "manual::x" });
  });

  it("does NOT pollute Object.prototype from a __proto__/constructor/prototype label payload", () => {
    const poison = JSON.parse(
      `{"version":${GROUPING_OVERRIDES_VERSION},"labels":{"__proto__":"x","constructor":"y","prototype":"z","ok":"manual::a"}}`,
    );
    const out = validateOverrides(poison);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).x).toBeUndefined();
    expect(out.labels).toEqual({ ok: "manual::a" }); // dangerous keys skipped, real one kept
  });
});

describe("isSafeKey", () => {
  it("rejects dangerous keys, allows obsKeys", () => {
    expect(isSafeKey("__proto__")).toBe(false);
    expect(isSafeKey("constructor")).toBe(false);
    expect(isSafeKey("prototype")).toBe(false);
    expect(isSafeKey("s1::csv-1")).toBe(true);
  });
});

describe("localStorage (jsdom)", () => {
  beforeEach(() => clearStoredOverrides());

  it("save then load round-trips", () => {
    const o = mergeUnderLabel(emptyOverrides(), ["s1::csv-1", "s1::csv-2"], "manual::x");
    expect(saveOverrides(o)).toBe(true);
    expect(loadOverrides()).toEqual(o);
  });

  it("load returns empty when nothing / garbage stored", () => {
    expect(loadOverrides()).toEqual(emptyOverrides());
    localStorage.setItem(GROUPING_OVERRIDES_STORAGE_KEY, "{bad");
    expect(loadOverrides()).toEqual(emptyOverrides());
  });
});
