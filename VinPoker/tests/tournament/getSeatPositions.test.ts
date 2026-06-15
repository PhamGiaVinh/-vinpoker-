import { describe, it, expect } from "vitest";
import { getSeatPositions, getPosition } from "@/lib/tournament/button";

const obj = (m: Map<number, string>) => Object.fromEntries(m);

describe("getSeatPositions", () => {
  it("6 contiguous seats, button on seat 1", () => {
    expect(obj(getSeatPositions([1, 2, 3, 4, 5, 6], 1))).toEqual({
      1: "BTN", 2: "SB", 3: "BB", 4: "UTG", 5: "LJ", 6: "HJ",
    });
  });

  it("gap-robust: seats 1,3,5,7 with button on seat 3", () => {
    // 4 players → BTN/SB/BB/CO, clockwise from the button seat.
    expect(obj(getSeatPositions([1, 3, 5, 7], 3))).toEqual({
      3: "BTN", 5: "SB", 7: "BB", 1: "CO",
    });
  });

  it("button on an empty seat falls to the next occupied seat clockwise", () => {
    expect(obj(getSeatPositions([1, 3, 5, 7], 2))).toEqual({
      3: "BTN", 5: "SB", 7: "BB", 1: "CO",
    });
  });

  it("wraps around the table", () => {
    expect(obj(getSeatPositions([2, 4, 6, 8], 8))).toEqual({
      8: "BTN", 2: "SB", 4: "BB", 6: "CO",
    });
  });

  it("9-handed includes UTG+1 and MP", () => {
    const m = getSeatPositions([1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
    expect(m.get(5)).toBe("BTN");
    expect(m.get(6)).toBe("SB");
    expect(m.get(7)).toBe("BB");
    expect(m.get(8)).toBe("UTG");
    expect(m.get(9)).toBe("UTG+1");
    expect(m.get(1)).toBe("MP");
    expect(m.get(4)).toBe("CO");
  });

  it("heads-up uses BTN/SB + BB", () => {
    expect(obj(getSeatPositions([3, 7], 3))).toEqual({ 3: "BTN/SB", 7: "BB" });
  });

  it("single player → BTN; empty → empty map", () => {
    expect(obj(getSeatPositions([4], 4))).toEqual({ 4: "BTN" });
    expect(getSeatPositions([], 1).size).toBe(0);
  });

  it("dedupes and ignores invalid seat numbers", () => {
    expect(obj(getSeatPositions([1, 1, 2, 3, 0, -2], 1))).toEqual({
      1: "BTN", 2: "SB", 3: "BB",
    });
  });

  it("11+ players fall back to +offset labels", () => {
    const m = getSeatPositions([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 1);
    expect(m.get(1)).toBe("+0");
    expect(m.get(2)).toBe("+1");
  });

  it("felt regression: getPosition mislabels gaps, getSeatPositions fixes it", () => {
    // After eliminations the live felt had seats 1,3,5,7 with the button on 3.
    // Old getPosition(seat, btn, total=4) does raw (seat−btn+total)%total, which
    // ignores the gaps: seat 5 → offset (5−3+4)%4 = 2 → "BB" (WRONG).
    expect(getPosition(5, 3, 4)).toBe("BB");
    // getSeatPositions orders the occupied seats clockwise → seat 5 is the SB.
    expect(getSeatPositions([1, 3, 5, 7], 3).get(5)).toBe("SB");
  });
});
