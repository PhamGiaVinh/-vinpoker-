import { describe, expect, it } from "vitest";
import { buildFloorSeatRoster } from "./floorTablePresentation";

describe("buildFloorSeatRoster", () => {
  it("renders exactly eight slots for an 8-max table", () => {
    const result = buildFloorSeatRoster([{
      seatNumber: 8,
      playerName: "Player A",
      chipsLabel: "30K",
      entryNumber: 1,
    }], 8);

    expect(result.slots).toHaveLength(8);
    expect(result.slots[7]?.seat?.playerName).toBe("Player A");
    expect(result.outOfRangeSeatNumbers).toEqual([]);
  });

  it("fails visibly when a seat is outside the selected capacity", () => {
    const result = buildFloorSeatRoster([{
      seatNumber: 9,
      playerName: "Player A",
      chipsLabel: "30K",
    }], 8);

    expect(result.slots).toHaveLength(8);
    expect(result.outOfRangeSeatNumbers).toEqual([9]);
  });

  it("reports duplicate seats instead of choosing a hidden winner", () => {
    const result = buildFloorSeatRoster([
      { seatNumber: 3, playerName: "Player A", chipsLabel: "30K" },
      { seatNumber: 3, playerName: "Player B", chipsLabel: "25K" },
    ], 9);

    expect(result.duplicateSeatNumbers).toEqual([3]);
    expect(result.slots[2]?.seat?.playerName).toBe("Player A");
  });
});
