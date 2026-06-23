// tests/pokerIQ/remoteContent.test.ts — authored question bank parsing/merge guard.
// Imports the PURE helpers from the barrel only (no supabase loader) so the test
// env stays client-free.
import { describe, it, expect } from "vitest";
import {
  approvedHands,
  DRILL_HANDS,
  DrillHand,
  isValidDrillHand,
  mergeHands,
  parseQuestionBank,
  POKER_IQ_QUESTIONS_KEY,
} from "@/lib/pokerIQ";

const valid: DrillHand = {
  id: "t1",
  contentVersion: "v1",
  reviewStatus: "approved",
  category: "vs_aggro",
  difficulty: "medium",
  villainProfile: "aggro",
  heroHand: "A♠ Q♠",
  position: "CO",
  stackBb: 38,
  scenario: "Bạn open 2.2BB, BTN 3-bet 8BB.",
  options: [
    { id: "a", label: "Fold", score: 30, leaks: ["overfold_vs_aggro"] },
    { id: "b", label: "Call", score: 80 },
  ],
  preferredBaseline: "b",
  acceptableAlternatives: [],
  explanation: "Trong đa số tình huống mặc định, call giữ range.",
  contentConfidence: "medium",
  provenanceNote: "Baseline call vs aggro 3-bet.",
};

describe("POKER_IQ_QUESTIONS_KEY", () => {
  it("is the stable app_settings key", () => {
    expect(POKER_IQ_QUESTIONS_KEY).toBe("poker_iq_questions");
  });
});

describe("isValidDrillHand", () => {
  it("accepts a well-formed hand", () => {
    expect(isValidDrillHand(valid)).toBe(true);
  });

  it("accepts the built-in static hands", () => {
    for (const h of DRILL_HANDS) expect(isValidDrillHand(h)).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isValidDrillHand(null)).toBe(false);
    expect(isValidDrillHand("x")).toBe(false);
    expect(isValidDrillHand(42)).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(isValidDrillHand({ ...valid, category: "nope" })).toBe(false);
  });

  it("rejects fewer than 2 options", () => {
    expect(isValidDrillHand({ ...valid, options: [valid.options[0]] })).toBe(false);
  });

  it("rejects a score out of 0–100", () => {
    expect(isValidDrillHand({ ...valid, options: [{ id: "a", label: "x", score: 140 }, { id: "b", label: "y", score: 50 }] })).toBe(false);
  });

  it("rejects a preferredBaseline that is not an option id", () => {
    expect(isValidDrillHand({ ...valid, preferredBaseline: "z" })).toBe(false);
  });

  it("rejects duplicate option ids", () => {
    expect(isValidDrillHand({ ...valid, options: [{ id: "a", label: "x", score: 10 }, { id: "a", label: "y", score: 20 }], preferredBaseline: "a" })).toBe(false);
  });

  it("rejects stackBb <= 0", () => {
    expect(isValidDrillHand({ ...valid, stackBb: 0 })).toBe(false);
  });

  it("rejects an empty scenario", () => {
    expect(isValidDrillHand({ ...valid, scenario: "   " })).toBe(false);
  });
});

describe("parseQuestionBank", () => {
  it("returns [] for non-array input", () => {
    expect(parseQuestionBank(null)).toEqual([]);
    expect(parseQuestionBank({})).toEqual([]);
    expect(parseQuestionBank("[]")).toEqual([]);
  });

  it("keeps valid hands and drops invalid ones", () => {
    const out = parseQuestionBank([valid, { id: "bad" }, { ...valid, id: "t2" }, 7]);
    expect(out.map((h) => h.id)).toEqual(["t1", "t2"]);
  });
});

describe("approvedHands", () => {
  it("returns only approved hands", () => {
    const draft = { ...valid, id: "t2", reviewStatus: "draft" as const };
    expect(approvedHands([valid, draft]).map((h) => h.id)).toEqual(["t1"]);
  });
});

describe("mergeHands", () => {
  const base: DrillHand[] = [
    { ...valid, id: "b1" },
    { ...valid, id: "b2" },
  ];

  it("appends new ids after the base order", () => {
    const out = mergeHands(base, [{ ...valid, id: "x1" }]);
    expect(out.map((h) => h.id)).toEqual(["b1", "b2", "x1"]);
  });

  it("overrides a base hand with the same id, in place", () => {
    const override = { ...valid, id: "b2", scenario: "OVERRIDDEN" };
    const out = mergeHands(base, [override]);
    expect(out.map((h) => h.id)).toEqual(["b1", "b2"]);
    expect(out.find((h) => h.id === "b2")?.scenario).toBe("OVERRIDDEN");
  });

  it("is a no-op shape when extra is empty", () => {
    expect(mergeHands(base, []).map((h) => h.id)).toEqual(["b1", "b2"]);
  });
});
