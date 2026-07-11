// A6 — null-model-first pattern guard. Locks that gambler's-fallacy / "pattern-selling" features are rejected
// by EXPLICIT REGISTRY MEMBERSHIP (not a keyword ban), and that a legitimate id whose name merely contains a
// pattern-ish word is NOT falsely rejected. No production behaviour changes — pattern ids were already unknown.
import { describe, it, expect } from "vitest";
import {
  patternStatus,
  patternFeatureAdmissible,
  PATTERN_FEATURE_IDS,
  buildFeatures,
  makeOrigin,
  classify,
  FeatureBoundaryError,
  type ResearchContract,
} from "./featureBoundary";

const origin = makeOrigin("2026-01-10T12:00:00+07:00");
const admitStatic = (key: string) => buildFeatures(origin, [{ key, value: 1 }]);

const PROHIBITED = [
  "hotEvent", "coldEvent", "dueEvent", "overdueEvent", "turnoutStreak",
  "winningStreak", "losingStreak", "lauChuaDong", "kyNayDenLuotDong", "gamblersFallacyTurnout",
];

describe("A6 pattern registry — prohibited gambler's-fallacy features", () => {
  it("classifies the hot/cold/due/overdue/streak family as prohibited", () => {
    for (const id of PROHIBITED) expect(patternStatus(id)).toBe("prohibited");
  });

  it("buildFeatures rejects every prohibited pattern id (with a pattern-specific reason)", () => {
    for (const id of PROHIBITED) {
      expect(() => admitStatic(id)).toThrow(FeatureBoundaryError);
      expect(() => admitStatic(id)).toThrow(/pattern feature/i);
    }
  });

  it("the research_only feature is rejected from production (no wired contract path)", () => {
    expect(patternStatus("timeSinceLastBigTurnout")).toBe("research_only");
    expect(patternFeatureAdmissible("timeSinceLastBigTurnout")).toBe(false); // no contract
    expect(() => admitStatic("timeSinceLastBigTurnout")).toThrow(/pattern feature/i);
  });
});

describe("A6 pattern guard is registry-membership, NOT a keyword ban", () => {
  it("a real model feature whose NAME contains a pattern-ish word is admitted (editionTrend has 'trend')", () => {
    expect(patternStatus("editionTrend")).toBeNull();
    expect(() => admitStatic("editionTrend")).not.toThrow(); // registered static_known ⇒ admitted
    expect(classify("editionTrend")).toBe("static_known");
  });

  it("no generic engineering word is banned: predict/forecast/probability/trend ids are NOT pattern features", () => {
    for (const id of ["predictedDemand", "forecastBias", "probabilityHigh", "trendUp", "trendSlope"]) {
      expect(patternStatus(id)).toBeNull(); // not a pattern feature — the guard does not apply
    }
    // …and none of those generic words appear as a registered pattern id
    for (const id of PATTERN_FEATURE_IDS) {
      expect(["predict", "forecast", "probability", "trend"]).not.toContain(id);
    }
  });

  it("an UNREGISTERED id containing a pattern-ish word fails closed as UNKNOWN, not as a pattern", () => {
    // rejection reason distinguishes the two: unknown (unclassified), not the pattern-doctrine message.
    expect(() => admitStatic("trendSlope")).toThrow(/unknown/i);
    expect(() => admitStatic("trendSlope")).not.toThrow(/pattern feature/i);
  });
});

describe("A6 research contract — the ONLY future admissibility path", () => {
  const complete: ResearchContract = {
    featureId: "timeSinceLastBigTurnout",
    nullModel: "iid lognormal turnout; time-since-last is independent of the next outcome",
    expectedUnderRandomness: "zero walk-forward skill over the median baseline",
    availability: "observed_by_origin",
    walkForwardProtocol: "strictly-earlier folds, MAPE vs median baseline on matched folds",
    minSampleSize: 30,
    trialCount: 1,
    ownerApproved: true,
  };

  it("admissible only with a complete, matching, owner-approved contract", () => {
    expect(patternFeatureAdmissible("timeSinceLastBigTurnout", complete)).toBe(true);
  });
  it("rejects an unapproved / incomplete / mismatched contract", () => {
    expect(patternFeatureAdmissible("timeSinceLastBigTurnout", { ...complete, ownerApproved: false })).toBe(false);
    expect(patternFeatureAdmissible("timeSinceLastBigTurnout", { ...complete, nullModel: "" })).toBe(false);
    expect(patternFeatureAdmissible("timeSinceLastBigTurnout", { ...complete, minSampleSize: 0 })).toBe(false);
    expect(patternFeatureAdmissible("timeSinceLastBigTurnout", { ...complete, trialCount: 0 })).toBe(false);
    expect(patternFeatureAdmissible("timeSinceLastBigTurnout", { ...complete, featureId: "hotEvent" })).toBe(false);
  });
  it("a prohibited feature is NEVER admissible, even with a contract", () => {
    expect(patternFeatureAdmissible("hotEvent", { ...complete, featureId: "hotEvent" })).toBe(false);
  });
  it("a non-pattern id is not governed by this gate (returns false, availability classification takes over)", () => {
    expect(patternFeatureAdmissible("logBuyin")).toBe(false);
    expect(patternStatus("logBuyin")).toBeNull();
  });
});
