import { describe, it, expect } from "vitest";
import {
  deriveTables,
  deriveFeed,
  deriveChipLeader,
  feedKind,
  feedLabel,
  fmtCompact,
  type RawSeat,
  type RawAction,
} from "@/components/cashier/tournament-live/viewer-hub/hubDerive";

describe("hubDerive — deriveTables", () => {
  const seats: RawSeat[] = [
    { player_id: "p1", seat_number: 1, table_id: "tA", is_active: true },
    { player_id: "p2", seat_number: 2, table_id: "tA", is_active: true },
    { player_id: "p3", seat_number: 3, table_id: "tB", is_active: true },
    { player_id: "", seat_number: 4, table_id: "tB", is_active: true }, // empty seat
    { player_id: "p5", seat_number: 5, table_id: "tB", is_active: false }, // inactive
    { player_id: "p6", seat_number: 6, table_id: null, is_active: true }, // no table
  ];
  it("groups active seated players by table with counts + names, sorted", () => {
    const tables = deriveTables(seats, { tA: "Bàn 1", tB: "Bàn 2" });
    expect(tables).toEqual([
      { tableId: "tA", name: "Bàn 1", playerCount: 2 },
      { tableId: "tB", name: "Bàn 2", playerCount: 1 },
    ]);
  });
  it("falls back to a short name when tableNames is missing", () => {
    const tables = deriveTables([{ player_id: "p1", seat_number: 1, table_id: "abcd1234", is_active: true }], {});
    expect(tables[0].name).toBe("Bàn abcd");
  });
  it("empty when no active seats", () => {
    expect(deriveTables([], {})).toEqual([]);
  });
});

describe("hubDerive — deriveFeed", () => {
  const names = new Map([["p1", "An"], ["p2", "Bình"]]);
  const seatsByP = new Map([["p1", 1], ["p2", 2]]);
  it("maps actions (newest-first) to rows with kind + label + name + seat", () => {
    const actions: RawAction[] = [
      { id: "a3", player_id: "p2", action_type: "all_in", action_amount: 5000, action_order: 3 },
      { id: "a2", player_id: "p1", action_type: "raise", action_amount: 1200, action_order: 2 },
      { id: "a1", player_id: "p1", action_type: "fold", action_amount: 0, action_order: 1 },
    ];
    const feed = deriveFeed(actions, names, seatsByP);
    expect(feed[0]).toEqual({ id: "a3", seatNumber: 2, playerName: "Bình", label: "ALL-IN 5k", kind: "allin" });
    expect(feed[1]).toMatchObject({ playerName: "An", kind: "raise", label: "Tố 1.2k" });
    expect(feed[2]).toMatchObject({ kind: "fold", label: "Bỏ bài" });
  });
  it("falls back to id from player+order and short name when missing", () => {
    const feed = deriveFeed(
      [{ player_id: "ghost123", action_type: "check", action_amount: 0, action_order: 7 }],
      new Map(),
      new Map(),
    );
    expect(feed[0].id).toBe("ghost123-7");
    expect(feed[0].seatNumber).toBe(0);
    expect(feed[0].playerName).toBe("ghost1");
    expect(feed[0].kind).toBe("check");
  });
});

describe("hubDerive — feedKind/feedLabel", () => {
  it("classifies posts + unknowns", () => {
    expect(feedKind("post_bb")).toBe("post");
    expect(feedKind("weird")).toBe("action");
    expect(feedLabel("post_sb", 50)).toBe("SB 50");
    expect(feedLabel("call", 2400)).toBe("Theo 2.4k");
  });
});

describe("hubDerive — deriveChipLeader", () => {
  it("returns the active player with the most chips, across tables", () => {
    const seats: RawSeat[] = [
      { player_id: "p1", seat_number: 1, player_name: "An", table_id: "tA", is_active: true, chip_count: 12000 },
      { player_id: "p2", seat_number: 5, player_name: "Bình", table_id: "tB", is_active: true, chip_count: 48000 },
      { player_id: "p3", seat_number: 2, player_name: "Cường", table_id: "tA", is_active: true, chip_count: 30000 },
    ];
    expect(deriveChipLeader(seats)).toEqual({ playerName: "Bình", seatNumber: 5, chipCount: 48000 });
  });

  it("ignores empty + inactive seats and non-positive stacks", () => {
    const seats: RawSeat[] = [
      { player_id: "", seat_number: 1, table_id: "tA", is_active: true, chip_count: 99999 }, // empty seat
      { player_id: "p2", seat_number: 2, player_name: "X", table_id: "tA", is_active: false, chip_count: 80000 }, // inactive
      { player_id: "p3", seat_number: 3, player_name: "Y", table_id: "tA", is_active: true, chip_count: 25000 },
    ];
    expect(deriveChipLeader(seats)).toEqual({ playerName: "Y", seatNumber: 3, chipCount: 25000 });
  });

  it("returns null when nobody has a positive stack (chip_count untracked)", () => {
    expect(deriveChipLeader([{ player_id: "p1", seat_number: 1, is_active: true }])).toBeNull();
    expect(deriveChipLeader([])).toBeNull();
  });

  it("falls back to a short id when player_name is missing", () => {
    const out = deriveChipLeader([{ player_id: "abcdef123", seat_number: 4, is_active: true, chip_count: 5000 }]);
    expect(out).toEqual({ playerName: "abcdef", seatNumber: 4, chipCount: 5000 });
  });
});

describe("hubDerive — fmtCompact", () => {
  it("formats with k/M and trims trailing .0", () => {
    expect(fmtCompact(950)).toBe("950");
    expect(fmtCompact(2400)).toBe("2.4k");
    expect(fmtCompact(48000)).toBe("48k");
    expect(fmtCompact(1_500_000)).toBe("1.5M");
  });
});
