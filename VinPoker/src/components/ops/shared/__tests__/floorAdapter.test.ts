// floorAdapter.test — khoá logic status/occupancy/chip theo đúng desktop (P0-5, P1-3).
// Nếu FloorTableMapPanel đổi tableStatus/normalization, test này phải được cập nhật CÙNG LÚC.
import { describe, expect, it } from "vitest";
import {
  tableStatus, buildSeatsByTable, buildEligibleFloorMoveTargets, chipDisplay, toMockTable, toMockSeat,
  type MapSeat, type MapTable,
} from "../floorAdapter";

const seat = (over: Partial<MapSeat>): MapSeat => ({
  seat_id: "s1", player_id: "p1", player_name: "A", entry_number: 1,
  table_id: "gt-1", table_name: "Bàn 1", seat_number: 1, chip_count: 30000, is_active: true,
  ...over,
});
const table = (over: Partial<MapTable>): MapTable => ({
  tt_id: "tt-1", table_id: "gt-1", table_number: 1, table_name: "Bàn 1", max_seats: 9, status: "active",
  ...over,
});

describe("tableStatus — copy verbatim desktop FloorTableMapPanel", () => {
  it("0 occupied → open", () => expect(tableStatus(0, "active", false)).toBe("open"));
  it("occupied > 0 → running", () => expect(tableStatus(5, "active", false)).toBe("running"));
  it("tournament break → paused (kể cả có người)", () => expect(tableStatus(5, "active", true)).toBe("paused"));
  it("break nhưng bàn không active → closed thắng paused (đúng thứ tự desktop)", () =>
    expect(tableStatus(5, "closed", true)).toBe("closed"));
  it("bàn không active → closed (kể cả 0 người)", () => expect(tableStatus(0, "inactive", false)).toBe("closed"));
});

describe("buildSeatsByTable — canonical id + is_active + sort (verbatim desktop)", () => {
  it("ghế trỏ tournament_tables.id được gom về game_tables.id", () => {
    const tables = [table({ tt_id: "tt-1", table_id: "gt-1" })];
    const seats = [
      seat({ seat_id: "a", table_id: "gt-1", seat_number: 3 }),  // convention cũ
      seat({ seat_id: "b", table_id: "tt-1", seat_number: 1 }),  // convention mới
    ];
    const grouped = buildSeatsByTable(tables, seats);
    expect(Object.keys(grouped)).toEqual(["gt-1"]);
    expect(grouped["gt-1"].map((s) => s.seat_number)).toEqual([1, 3]); // sorted
  });
  it("ghế is_active=false bị loại (đã bust không chiếm ghế)", () => {
    const grouped = buildSeatsByTable([table({})], [seat({ is_active: false })]);
    expect(grouped["gt-1"]).toBeUndefined();
  });
  it("ghế của bàn lạ giữ nguyên key (không nuốt mất)", () => {
    const grouped = buildSeatsByTable([table({})], [seat({ table_id: "gt-unknown" })]);
    expect(grouped["gt-unknown"]).toHaveLength(1);
  });
});

describe("buildEligibleFloorMoveTargets — same destination contract as the move RPC", () => {
  it("only exposes active, linked tables with a free seat", () => {
    const targets = buildEligibleFloorMoveTargets([
      table({ tt_id: "tt-open", table_id: "gt-open", max_seats: 3 }),
      table({ tt_id: "tt-closed", table_id: "gt-closed", status: "closed" }),
      table({ tt_id: "tt-unlinked", table_id: "" }),
    ], {
      "gt-open": [seat({ table_id: "gt-open", seat_number: 1 }), seat({ seat_id: "s2", table_id: "gt-open", seat_number: 3 })],
      "gt-closed": [],
    });

    expect(targets).toEqual([{ tt_id: "tt-open", table_number: 1, freeSeats: [2] }]);
  });
});

describe("chipDisplay — P1-3: 0 khác null", () => {
  it("null/undefined → —", () => {
    expect(chipDisplay(null)).toBe("—");
    expect(chipDisplay(undefined)).toBe("—");
  });
  it('0 → "0" (không được nuốt số 0)', () => expect(chipDisplay(0)).toBe("0"));
  it("1000000 → định dạng vi-VN", () => expect(chipDisplay(1_000_000)).toBe((1_000_000).toLocaleString("vi-VN")));
});

describe("toMockTable / toMockSeat — adapter sang shape shared components", () => {
  it("map đủ trường + status theo desktop", () => {
    const m = toMockTable(table({ table_number: 7, max_seats: 8 }), 5, false, 1000);
    expect(m).toEqual({ tableNo: 7, status: "running", occ: 5, max: 8, dealer: null });
  });
  it("table_number null → dùng fallbackNo (unique)", () => {
    expect(toMockTable(table({ table_number: null }), 0, false, 1042).tableNo).toBe(1042);
  });
  it("seat map: chip 0 hiện '0', entryNo giữ nguyên", () => {
    const s = toMockSeat(seat({ chip_count: 0, entry_number: 2, seat_number: 4, player_name: "Minh" }));
    expect(s).toEqual({ seat: 4, name: "Minh", chip: "0", entryNo: 2 });
  });
});
