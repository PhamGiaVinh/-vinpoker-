// trackerShowdownRevealOrder — the pure reveal-order helper. Standard poker/TDA:
// last aggressor on the final betting street tables first; else first-to-act from the
// SB (button-relative), then clockwise. Only the showing seats are ordered.
import { describe, it, expect } from "vitest";
import { showdownRevealOrder } from "@/lib/tracker-poker/trackerEngine";

describe("showdownRevealOrder", () => {
  it("≤1 shown seat → returned as-is", () => {
    expect(showdownRevealOrder({ shownSeatNumbers: [], buttonSeat: 1 })).toEqual([]);
    expect(showdownRevealOrder({ shownSeatNumbers: [4], buttonSeat: 1 })).toEqual([4]);
  });

  it("no final-street bet → first-to-act (left of button = SB) shows first, then clockwise", () => {
    // Button on seat 2, shown seats 1,3,5. First-to-act postflop = first active left of
    // the button clockwise = seat 3, then 5, then 1.
    expect(showdownRevealOrder({ shownSeatNumbers: [1, 3, 5], buttonSeat: 2, finalAggressorSeat: null })).toEqual([
      3, 5, 1,
    ]);
  });

  it("final-street aggressor tables FIRST, then clockwise from them", () => {
    // Seat 5 bet the river; button seat 2. Reveal: 5 first, then 1, then 3.
    expect(showdownRevealOrder({ shownSeatNumbers: [1, 3, 5], buttonSeat: 2, finalAggressorSeat: 5 })).toEqual([
      5, 1, 3,
    ]);
  });

  it("aggressor not among shown (e.g. bettor got folded out) → falls back to first-to-act", () => {
    expect(showdownRevealOrder({ shownSeatNumbers: [1, 3, 5], buttonSeat: 2, finalAggressorSeat: 9 })).toEqual([
      3, 5, 1,
    ]);
  });

  it("heads-up: no aggressor → first-to-act is the non-button (seat after button)", () => {
    // Button seat 1, shown seats 1 & 2. Postflop first-to-act = seat 2 (BB), then 1.
    expect(showdownRevealOrder({ shownSeatNumbers: [1, 2], buttonSeat: 1, finalAggressorSeat: null })).toEqual([2, 1]);
  });

  it("heads-up: button bet the river → button (aggressor) shows first", () => {
    expect(showdownRevealOrder({ shownSeatNumbers: [1, 2], buttonSeat: 1, finalAggressorSeat: 1 })).toEqual([1, 2]);
  });

  it("preflop all-in (button-relative order): from SB regardless of the BB, then clockwise", () => {
    // Everyone all-in preflop, no final-street 'aggressor' passed → button seat 9,
    // shown 1..3,7..9. First active left of button clockwise = seat 1.
    expect(
      showdownRevealOrder({ shownSeatNumbers: [9, 1, 2, 3, 7, 8], buttonSeat: 9, finalAggressorSeat: null })
    ).toEqual([1, 2, 3, 7, 8, 9]);
  });

  it("gap/dedup robust + wraps the ring correctly", () => {
    expect(showdownRevealOrder({ shownSeatNumbers: [2, 2, 8, 5], buttonSeat: 8, finalAggressorSeat: null })).toEqual([
      2, 5, 8,
    ]);
  });
});
