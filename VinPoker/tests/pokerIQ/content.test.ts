// tests/pokerIQ/content.test.ts — hand-bank integrity + honest-wording guard.
import { describe, it, expect } from "vitest";
import { ALL_CONTENT_APPROVED, DRILL_CATEGORIES, DRILL_HANDS } from "@/lib/pokerIQ";

describe("Poker IQ hand bank", () => {
  it("has 20 hands, 4 per category", () => {
    expect(DRILL_HANDS).toHaveLength(20);
    for (const c of DRILL_CATEGORIES) {
      expect(DRILL_HANDS.filter((h) => h.category === c)).toHaveLength(4);
    }
  });

  it("has unique ids", () => {
    expect(new Set(DRILL_HANDS.map((h) => h.id)).size).toBe(20);
  });

  it("every hand is well-formed", () => {
    for (const h of DRILL_HANDS) {
      expect(h.options.length).toBeGreaterThanOrEqual(3);
      expect(h.options.length).toBeLessThanOrEqual(4);
      expect(h.options.some((o) => o.id === h.preferredBaseline)).toBe(true);
      expect(h.contentVersion).toBeTruthy();
      expect(h.explanation.trim().length).toBeGreaterThan(0);
      expect(h.provenanceNote.trim().length).toBeGreaterThan(0);
      for (const o of h.options) {
        expect(o.score).toBeGreaterThanOrEqual(0);
        expect(o.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("ships as draft until coach/TD review (not production-approved)", () => {
    expect(DRILL_HANDS.every((h) => h.reviewStatus === "draft")).toBe(true);
    expect(ALL_CONTENT_APPROVED).toBe(false);
  });

  it("uses baseline wording, never dogmatic / guarantee phrasing", () => {
    const banned = ["đáp án đúng", "đảm bảo", "chắc chắn", "chắc thắng", "correct answer"];
    for (const h of DRILL_HANDS) {
      const text = `${h.scenario} ${h.explanation} ${h.provenanceNote}`.toLowerCase();
      for (const w of banned) expect(text.includes(w)).toBe(false);
    }
  });
});
