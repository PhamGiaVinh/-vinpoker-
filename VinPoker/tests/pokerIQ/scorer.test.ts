// tests/pokerIQ/scorer.test.ts — fixture-based scoring (locked to scoringVersion).
import { describe, it, expect } from "vitest";
import { categoryScores, gradeFromScore, totalScore } from "@/lib/pokerIQ";
import { DRILL_HANDS } from "@/lib/pokerIQ";
import { DEMO_ANSWERS } from "@/lib/pokerIQ";

describe("gradeFromScore — transparent provisional thresholds", () => {
  it("maps scores to letters at the documented boundaries", () => {
    expect(gradeFromScore(90)).toBe("A-");
    expect(gradeFromScore(85)).toBe("A-");
    expect(gradeFromScore(84)).toBe("B+");
    expect(gradeFromScore(74)).toBe("B+");
    expect(gradeFromScore(73)).toBe("B+");
    expect(gradeFromScore(72)).toBe("B");
    expect(gradeFromScore(66)).toBe("B");
    expect(gradeFromScore(65)).toBe("C+");
    expect(gradeFromScore(58)).toBe("C+");
    expect(gradeFromScore(57)).toBe("C");
    expect(gradeFromScore(50)).toBe("C");
    expect(gradeFromScore(49)).toBe("Đang phát triển");
  });
});

describe("category subscores from the canonical fixture", () => {
  const cs = categoryScores(DRILL_HANDS, DEMO_ANSWERS);
  const map = Object.fromEntries(cs.map((c) => [c.category, c.score]));

  it("produces the expected per-category scores", () => {
    expect(map.preflop_discipline).toBe(82);
    expect(map.position_steal).toBe(68);
    expect(map.vs_aggro).toBe(60);
    expect(map.vs_nit_passive).toBe(85);
    expect(map.tournament_pressure).toBe(74);
  });

  it("Poker IQ total is the mean of answered categories", () => {
    expect(totalScore(cs)).toBe(74);
  });
});
