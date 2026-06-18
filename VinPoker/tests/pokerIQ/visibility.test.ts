// tests/pokerIQ/visibility.test.ts — public/private contract (own vs other view).
import { describe, it, expect } from "vitest";
import { computeDrillResult, DRILL_HANDS, DEMO_ANSWERS, toPublicProfile } from "@/lib/pokerIQ";

const full = computeDrillResult(DRILL_HANDS, DEMO_ANSWERS);
const pub = toPublicProfile(full);

describe("public profile = identity / achievement / aspiration only", () => {
  it("exposes grade, style, provisional flag and confidence", () => {
    expect(pub).toEqual({
      grade: full.grade,
      archetype: full.archetype,
      isProvisional: full.isProvisional,
      confidence: full.confidence,
    });
  });

  it("NEVER leaks weaknesses, odds, category scores, training or events", () => {
    const keys = Object.keys(pub);
    for (const hidden of [
      "leaks",
      "categoryScores",
      "weakestCategory",
      "recommendedDrill",
      "suggestedEvent",
      "totalScore",
    ]) {
      expect(keys).not.toContain(hidden);
    }
  });
});
