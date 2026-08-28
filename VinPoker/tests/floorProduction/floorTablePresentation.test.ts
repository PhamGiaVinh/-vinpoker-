import { describe, expect, it } from "vitest";
import {
  buildFloorSeatRoster,
  buildFloorTableNumberOptions,
  FIXED_FLOOR_TABLE_SEATS,
} from "../../src/components/ops/shared/floorTablePresentation";

describe("Floor table picker presentation", () => {
  it("builds exactly 100 server-revalidated table-number choices", () => {
    const options = buildFloorTableNumberOptions([
      { table_number: 1, status: "active" },
      { table_number: 2, status: "closed" },
      { table_number: 2, status: "active" },
      { table_number: 30, status: "closed" },
      { table_number: 0, status: "closed" },
      { table_number: 101, status: "active" },
    ]);

    expect(options).toHaveLength(100);
    expect(options[0]).toEqual({ number: 1, state: "active" });
    expect(options[1]).toEqual({ number: 2, state: "active" });
    expect(options[2]).toEqual({ number: 3, state: "available" });
    expect(options[29]).toEqual({ number: 30, state: "closed" });
    expect(options.at(-1)).toEqual({ number: 100, state: "available" });
  });

  it("always renders nine roster slots and preserves Empty positions", () => {
    const roster = buildFloorSeatRoster([
      { seatNumber: 1, playerName: "Player A", chipsLabel: "30.000" },
      { seatNumber: 9, playerName: "Player I", chipsLabel: "0" },
    ]);

    expect(roster.slots).toHaveLength(FIXED_FLOOR_TABLE_SEATS);
    expect(roster.slots[0].seat?.playerName).toBe("Player A");
    expect(roster.slots[1]).toEqual({ seatNumber: 2, seat: null });
    expect(roster.slots[8].seat?.playerName).toBe("Player I");
  });

  it("keeps another session's physical table disabled in the V3 inventory picker", () => {
    const options = buildFloorTableNumberOptions([
      {
        table_number: 5,
        status: "active",
        availability_status: "in_use",
        session_type: "tournament",
      },
      {
        table_number: 6,
        status: null,
        availability_status: "maintenance",
        session_type: null,
      },
    ], "unavailable");

    expect(options[4]).toMatchObject({ number: 5, state: "active", detail: "Đang dùng · Giải" });
    expect(options[5]).toMatchObject({ number: 6, state: "unavailable", detail: "Bảo trì" });
    expect(options[6]).toEqual({ number: 7, state: "unavailable" });
  });

  it("fails visibly on duplicate seats instead of choosing a hidden winner", () => {
    const roster = buildFloorSeatRoster([
      { seatNumber: 4, playerName: "First", chipsLabel: "10" },
      { seatNumber: 4, playerName: "Second", chipsLabel: "20" },
      { seatNumber: 10, playerName: "Legacy tenth seat", chipsLabel: "30" },
    ]);

    expect(roster.duplicateSeatNumbers).toEqual([4]);
    expect(roster.outOfRangeSeatNumbers).toEqual([10]);
    expect(roster.slots[3].seat?.playerName).toBe("First");
  });
});
