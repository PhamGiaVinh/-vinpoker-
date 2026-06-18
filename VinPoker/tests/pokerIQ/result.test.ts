// tests/pokerIQ/result.test.ts — full result + semantic invariants on the
// canonical "B+ · Tight Solid" fixture.
import { describe, it, expect } from "vitest";
import { computeDrillResult, DRILL_HANDS, DEMO_ANSWERS } from "@/lib/pokerIQ";

const r = computeDrillResult(DRILL_HANDS, DEMO_ANSWERS);

describe("computeDrillResult — canonical fixture", () => {
  it("grade and total", () => {
    expect(r.totalScore).toBe(74);
    expect(r.grade).toBe("B+");
  });

  it("archetype is Tight Solid", () => {
    expect(r.archetype).toBe("tight_solid");
  });

  it("weakest category is vs_aggro and the CTA/training maps to it", () => {
    expect(r.weakestCategory).toBe("vs_aggro");
    expect(r.recommendedDrill).toBe(r.weakestCategory);
  });

  it("leaks surface the weakest areas (incl. over-fold vs aggro)", () => {
    expect(r.leaks).toContain("overfold_vs_aggro");
    expect(r.leaks.length).toBeLessThanOrEqual(3);
  });

  it("strengths surface a positive identity (incl. reading nits)", () => {
    expect(r.strengths).toContain("read_nit");
    expect(r.strengths.length).toBeLessThanOrEqual(3);
  });

  it("is always provisional with low confidence in MVP 1", () => {
    expect(r.isProvisional).toBe(true);
    expect(r.confidence).toBe("low");
  });

  it("suggested event fits the style and avoids the weakness", () => {
    expect(r.suggestedEvent.fit).toBe("deepstack_mid_field");
    expect(r.suggestedEvent.avoid).toBe("turbo_short_stack");
  });

  it("carries all three versions for cohort comparability", () => {
    expect(r.scoringVersion).toBeTruthy();
    expect(r.resultSchemaVersion).toBeTruthy();
    expect(r.contentVersion).toBeTruthy();
  });

  it("is deterministic (snapshot locked to scoringVersion)", () => {
    expect(r).toMatchSnapshot();
  });
});
