import { describe, expect, it } from "vitest";
import { isValidBlindDraft, suggestBlindDraft } from "./blindDraftSuggest";

const input = { startingStack: 50_000, startingDepth: 250, targetMinutes: 480,
  levelMinutes: 30, breakEvery: 4, breakMinutes: 15 };

describe("blind structure setup draft", () => {
  it("generates numbered BB-ante levels and breaks without a trailing break", () => {
    const rows = suggestBlindDraft(input);
    expect(rows[0].big_blind).toBe(200);
    expect(rows[4].is_break).toBe(true);
    expect(rows[4].duration_minutes).toBe(15);
    expect(rows.at(-1)?.is_break).toBe(false);
    expect(rows.map(row => row.level_number)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.reduce((sum, row) => sum + row.duration_minutes, 0)).toBeGreaterThanOrEqual(480);
    expect(isValidBlindDraft(rows)).toBe(true);
  });

  it.each([NaN, Infinity, -1, 0, 1.5, 1e16])("rejects invalid stack %s", startingStack => {
    expect(() => suggestBlindDraft({ ...input, startingStack })).toThrow(RangeError);
  });

  it("bounds the maximum schedule and allows no-break drafts", () => {
    const rows = suggestBlindDraft({ ...input, targetMinutes: 720, levelMinutes: 10, breakMinutes: 0 });
    expect(rows).toHaveLength(72);
    expect(isValidBlindDraft(rows)).toBe(true);
  });

  it("rejects invalid edited blinds, durations and missing play", () => {
    const rows = suggestBlindDraft(input);
    expect(isValidBlindDraft([])).toBe(false);
    for (const big_blind of [NaN, Infinity, -1, 1.5, 50]) {
      expect(isValidBlindDraft([{ ...rows[0], big_blind }])).toBe(false);
    }
    expect(isValidBlindDraft([{ ...rows[4], ante: 100 }])).toBe(false);
    expect(isValidBlindDraft([rows[4]])).toBe(false);
    expect(isValidBlindDraft([{ ...rows[0], duration_minutes: 0 }])).toBe(false);
  });
});
