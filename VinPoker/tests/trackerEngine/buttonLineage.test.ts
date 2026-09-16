import { describe, expect, it } from "vitest";
import { nextButtonFromBlindLineage } from "@/lib/tournament/deadButton";
import { nextButtonFromBlindLineage as edgePlacement } from "../../supabase/functions/_shared/pokerEngine/button.ts";

describe("next button from recorded blind positions", () => {
  it("moves the old small blind to the button across long-empty physical seats", () => {
    expect(nextButtonFromBlindLineage({
      maxSeats: 9,
      occupiedSeats: [1, 2, 4, 6, 8, 9],
      previousDealtSeats: [1, 2, 4, 6, 8, 9],
      previousButtonSeat: 2,
      previousSbPosition: 4,
      previousBbSeat: 6,
    })).toEqual({ buttonSeat: 4, sbSeat: 6, bbSeat: 8, deadButton: false, deadSb: false });
  });

  it("keeps the old small-blind position as a dead button after its player busts", () => {
    expect(nextButtonFromBlindLineage({
      maxSeats: 9,
      occupiedSeats: [1, 2, 6, 8, 9],
      previousDealtSeats: [1, 2, 4, 6, 8, 9],
      previousButtonSeat: 2,
      previousSbPosition: 4,
      previousBbSeat: 6,
    })).toEqual({ buttonSeat: 4, sbSeat: 6, bbSeat: 8, deadButton: true, deadSb: false });
  });

  it("keeps the old big-blind position as a dead small blind after its player busts", () => {
    expect(nextButtonFromBlindLineage({
      maxSeats: 9,
      occupiedSeats: [1, 2, 4, 8, 9],
      previousDealtSeats: [1, 2, 4, 6, 8, 9],
      previousButtonSeat: 2,
      previousSbPosition: 4,
      previousBbSeat: 6,
    })).toEqual({ buttonSeat: 4, sbSeat: null, bbSeat: 8, deadButton: false, deadSb: true });
  });

  it("advances the hand following a dead small blind without inventing a live blind", () => {
    const input = {
      maxSeats: 9, occupiedSeats: [1, 2, 4, 8, 9],
      previousDealtSeats: [1, 2, 4, 8, 9],
      previousButtonSeat: 4, previousSbPosition: 6, previousBbSeat: 8,
    };
    expect(nextButtonFromBlindLineage(input)).toEqual({
      buttonSeat: 6, sbSeat: 8, bbSeat: 9, deadButton: true, deadSb: false,
    });
    expect(edgePlacement(input)).toEqual(nextButtonFromBlindLineage(input));
  });

  it("handles two consecutive busts and physical wraparound", () => {
    expect(nextButtonFromBlindLineage({
      maxSeats: 9, occupiedSeats: [1, 2, 8, 9],
      previousDealtSeats: [1, 2, 4, 6, 8, 9],
      previousButtonSeat: 2, previousSbPosition: 4, previousBbSeat: 6,
    })).toEqual({ buttonSeat: 4, sbSeat: null, bbSeat: 8, deadButton: true, deadSb: true });
    expect(nextButtonFromBlindLineage({
      maxSeats: 9, occupiedSeats: [1, 2, 4, 6],
      previousDealtSeats: [1, 2, 4, 6, 8, 9],
      previousButtonSeat: 6, previousSbPosition: 8, previousBbSeat: 9,
    })).toEqual({ buttonSeat: 8, sbSeat: null, bbSeat: 1, deadButton: true, deadSb: true });
  });

  it("refuses to guess from the BB alone or malformed lineage", () => {
    const base = {
      maxSeats: 9, occupiedSeats: [1, 2, 4, 6, 8, 9],
      previousDealtSeats: [1, 2, 4, 6, 8, 9], previousButtonSeat: 2, previousBbSeat: 6,
    };
    expect(nextButtonFromBlindLineage({ ...base, previousSbPosition: null })).toBeNull();
    expect(nextButtonFromBlindLineage({ ...base, previousSbPosition: 8 })).toBeNull();
  });

  it("uses the heads-up rule only when the old BB is still at the table", () => {
    const base = {
      maxSeats: 9, occupiedSeats: [4, 6], previousDealtSeats: [2, 4, 6],
      previousButtonSeat: 2, previousSbPosition: 4,
    };
    expect(nextButtonFromBlindLineage({ ...base, previousBbSeat: 6 })).toEqual({
      buttonSeat: 6, sbSeat: 6, bbSeat: 4, deadButton: false, deadSb: false,
    });
    expect(nextButtonFromBlindLineage({ ...base, previousBbSeat: 8 })).toBeNull();
  });

  it("rejects a previous BB that was not dealt into that hand", () => {
    expect(nextButtonFromBlindLineage({
      maxSeats: 9, occupiedSeats: [1, 2, 4, 6, 8, 9],
      previousDealtSeats: [1, 2, 4, 8, 9],
      previousButtonSeat: 2, previousSbPosition: 4, previousBbSeat: 6,
    })).toBeNull();
  });
});
