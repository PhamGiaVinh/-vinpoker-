// A1 — point-in-time feature availability boundary. Locks the leakage contract at RUNTIME: only StaticKnown +
// validated ObservedByOrigin are admissible; outcomes / unknowns / future observations fail closed.
import { describe, it, expect } from "vitest";
import {
  buildFeatures,
  makeOrigin,
  parseOrigin,
  parseObservedFeature,
  classify,
  isKnownFeature,
  assertModelFeaturesStatic,
  FeatureBoundaryError,
  MODEL_FEATURE_KEYS,
  type StaticFeature,
  type ObservedFeature,
} from "./featureBoundary";

const ORIGIN_ISO = "2026-01-10T12:00:00+07:00"; // 05:00:00Z
const origin = makeOrigin(ORIGIN_ISO);

describe("A1 registry & classification", () => {
  it("classifies the three lanes and fails closed on unknown", () => {
    expect(classify("logBuyin")).toBe("static_known");
    expect(classify("entriesSoFar")).toBe("observed_by_origin");
    expect(classify("finalEntries")).toBe("outcome_only");
    expect(isKnownFeature("nope")).toBe(false);
    expect(() => classify("nope")).toThrow(FeatureBoundaryError);
  });

  it("the SAME quantity is split by availability via distinct keys (entriesSoFar vs finalEntries)", () => {
    expect(classify("entriesSoFar")).toBe("observed_by_origin"); // mid-registration snapshot → a feature
    expect(classify("finalEntries")).toBe("outcome_only"); // end-of-event total → the TARGET, never a feature
    expect(classify("capacityPlanned")).toBe("static_known"); // known in advance
    expect(classify("capacityObserved")).toBe("observed_by_origin"); // filled-so-far → runtime observation
  });

  it("every model feature key is StaticKnown", () => {
    expect(() => assertModelFeaturesStatic()).not.toThrow();
    for (const k of MODEL_FEATURE_KEYS) expect(classify(k)).toBe("static_known");
  });
});

describe("A1 buildFeatures — admission gate", () => {
  const staticFeat: StaticFeature = { key: "logBuyin", value: 13.8 };

  it("accepts a static feature", () => {
    const built = buildFeatures(origin, [staticFeat]);
    expect(built.values.logBuyin).toBe(13.8);
    expect(built.availability.logBuyin).toBe("static_known");
    expect(built.origin.originMs).toBe(origin.originMs);
  });

  it("accepts an observed feature when observedAt <= origin", () => {
    const obs: ObservedFeature = { key: "entriesSoFar", value: 42, observedAt: "2026-01-10T04:00:00Z" };
    const built = buildFeatures(origin, [], [obs]);
    expect(built.values.entriesSoFar).toBe(42);
    expect(built.availability.entriesSoFar).toBe("observed_by_origin");
  });

  it("accepts an observation at the EXACT origin instant (boundary is inclusive)", () => {
    const obs: ObservedFeature = { key: "entriesSoFar", value: 7, observedAt: ORIGIN_ISO }; // == origin
    expect(() => buildFeatures(origin, [], [obs])).not.toThrow();
    // and a different offset spelling the same instant is also exactly on the boundary
    const obsUtc: ObservedFeature = { key: "entriesSoFar", value: 7, observedAt: "2026-01-10T05:00:00Z" };
    expect(() => buildFeatures(origin, [], [obsUtc])).not.toThrow();
  });

  it("rejects an observation with observedAt > origin (future leakage)", () => {
    const obs: ObservedFeature = { key: "entriesSoFar", value: 99, observedAt: "2026-01-10T05:00:01Z" };
    expect(() => buildFeatures(origin, [], [obs])).toThrow(/future leakage/i);
  });

  it("handles timezone-equivalent timestamps consistently (compares by instant, not string)", () => {
    // +07:00 noon and 05:00Z are the same instant. One second earlier in ANY offset is admissible; one second
    // later in ANY offset is rejected — the offset spelling must not change the verdict.
    const justBefore: ObservedFeature = { key: "queueLength", value: 3, observedAt: "2026-01-10T11:59:59+07:00" };
    const justAfter: ObservedFeature = { key: "queueLength", value: 3, observedAt: "2026-01-10T05:00:01Z" };
    expect(() => buildFeatures(origin, [], [justBefore])).not.toThrow();
    expect(() => buildFeatures(origin, [], [justAfter])).toThrow(FeatureBoundaryError);
  });

  it("rejects an outcome-only feature in EITHER lane", () => {
    expect(() => buildFeatures(origin, [{ key: "finalEntries", value: 300 }])).toThrow(/outcome/i);
    const asObs: ObservedFeature = { key: "finalRake", value: 1, observedAt: "2026-01-10T00:00:00Z" };
    expect(() => buildFeatures(origin, [], [asObs])).toThrow(/not observed_by_origin/i);
  });

  it("rejects an unknown/unclassified feature (fail closed)", () => {
    expect(() => buildFeatures(origin, [{ key: "mysteryVibes", value: 1 }])).toThrow(/unknown/i);
  });

  it("rejects a static feature routed as observed and vice versa (wrong lane)", () => {
    const staticAsObs: ObservedFeature = { key: "logBuyin", value: 13.8, observedAt: "2026-01-10T00:00:00Z" };
    expect(() => buildFeatures(origin, [], [staticAsObs])).toThrow(/not observed_by_origin/i);
    expect(() => buildFeatures(origin, [{ key: "entriesSoFar", value: 1 }])).toThrow(/not static_known/i);
  });

  it("rejects a duplicate key within one admission", () => {
    expect(() => buildFeatures(origin, [staticFeat, { key: "logBuyin", value: 1 }])).toThrow(/duplicate/i);
  });

  it("does not mutate its inputs", () => {
    const statics: StaticFeature[] = [{ key: "logBuyin", value: 13.8 }];
    const observed: ObservedFeature[] = [{ key: "entriesSoFar", value: 42, observedAt: "2026-01-10T00:00:00Z" }];
    const staticsCopy = JSON.stringify(statics);
    const observedCopy = JSON.stringify(observed);
    buildFeatures(origin, statics, observed);
    expect(JSON.stringify(statics)).toBe(staticsCopy);
    expect(JSON.stringify(observed)).toBe(observedCopy);
  });

  it("is deterministic (same inputs ⇒ identical bundle)", () => {
    const statics: StaticFeature[] = [{ key: "logBuyin", value: 13.8 }, { key: "isHoliday", value: 1 }];
    const observed: ObservedFeature[] = [{ key: "entriesSoFar", value: 42, observedAt: "2026-01-10T00:00:00Z" }];
    const a = buildFeatures(origin, statics, observed);
    const b = buildFeatures(origin, statics, observed);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("A1 makeOrigin / parsers — runtime validation of imported data (typing not trusted)", () => {
  it("makeOrigin rejects an unparseable timestamp and canonicalises a valid one", () => {
    expect(() => makeOrigin("not-a-date")).toThrow(FeatureBoundaryError);
    expect(makeOrigin(ORIGIN_ISO).originTs).toBe("2026-01-10T05:00:00.000Z"); // canonical UTC
    expect(makeOrigin(ORIGIN_ISO).originMs).toBe(Date.parse("2026-01-10T05:00:00Z"));
  });

  it("parseOrigin accepts a string or an { originTs } object, rejects junk", () => {
    expect(parseOrigin(ORIGIN_ISO).originMs).toBe(origin.originMs);
    expect(parseOrigin({ originTs: ORIGIN_ISO }).originMs).toBe(origin.originMs);
    expect(() => parseOrigin({ originTs: 12345 })).toThrow(FeatureBoundaryError);
    expect(() => parseOrigin(null)).toThrow(FeatureBoundaryError);
    expect(() => parseOrigin({ nope: 1 })).toThrow(FeatureBoundaryError);
  });

  it("parseObservedFeature enforces shape + finite value + valid timestamp", () => {
    const ok = parseObservedFeature({ key: "entriesSoFar", value: 10, observedAt: "2026-01-10T00:00:00Z" });
    expect(ok.value).toBe(10);
    expect(() => parseObservedFeature({ key: "entriesSoFar", value: 10 })).toThrow(/observedAt/i);
    expect(() => parseObservedFeature({ key: "entriesSoFar", value: "10", observedAt: "2026-01-10T00:00:00Z" })).toThrow(
      /finite number/i,
    );
    expect(() => parseObservedFeature({ key: 5, value: 1, observedAt: "2026-01-10T00:00:00Z" })).toThrow(/key/i);
    expect(() => parseObservedFeature({ key: "entriesSoFar", value: 1, observedAt: "nope" })).toThrow(/observedAt/i);
    expect(() => parseObservedFeature(null)).toThrow(FeatureBoundaryError);
  });

  it("a parsed-then-built observation still respects the origin boundary", () => {
    const raw: unknown = { key: "entriesSoFar", value: 10, observedAt: "2026-01-10T09:00:00Z" }; // AFTER origin
    const obs = parseObservedFeature(raw); // shape ok…
    expect(() => buildFeatures(origin, [], [obs])).toThrow(/future leakage/i); // …but timing rejected
  });
});
