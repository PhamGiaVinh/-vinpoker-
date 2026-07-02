import { describe, it, expect } from "vitest";
import { computeRankShifts } from "@/lib/tracker-poker/rankShift";

const LEADERBOARD = [
  { player_id: "a", chip_count: 12300000 }, // rank 1
  { player_id: "b", chip_count: 5000000 }, // rank 2
  { player_id: "c", chip_count: 4000000 }, // rank 3 (not seated this hand)
  { player_id: "d", chip_count: 2400000 }, // rank 4
];

const PLAYERS = [
  { player_id: "a", seat_number: 1, display_name: "GUIDO", current_stack: 10200000 },
  { player_id: "b", seat_number: 2, display_name: "KIÊN", current_stack: 8500000 },
];

describe("computeRankShifts", () => {
  it("returns [] when nothing about the seated players' rank changes", () => {
    expect(computeRankShifts(LEADERBOARD, PLAYERS, {})).toEqual([]);
  });

  it("a big all-in win moves the winner up and the loser down", () => {
    // b busts a down to 3.8M, passing them for rank 1. a also drops below c's
    // untouched 4M snapshot, landing at rank 3 (not 2) — c never moves but the
    // ranking around it still shifts.
    const shifts = computeRankShifts(LEADERBOARD, PLAYERS, { a: 3800000, b: 10200000 });
    const a = shifts.find((s) => s.player_id === "a");
    const b = shifts.find((s) => s.player_id === "b");
    expect(b).toEqual({ player_id: "b", seat_number: 2, display_name: "KIÊN", before: 2, after: 1 });
    expect(a).toEqual({ player_id: "a", seat_number: 1, display_name: "GUIDO", before: 1, after: 3 });
  });

  it("only THIS table's seated players' rows move — untouched players keep their snapshot chip_count", () => {
    // a doubles through b; c (not in `players`) must never shift even though the
    // table around them reshuffles.
    const shifts = computeRankShifts(LEADERBOARD, PLAYERS, { a: 17300000, b: 0 });
    expect(shifts.find((s) => s.player_id === "c")).toBeUndefined();
  });

  it("falls back to current_stack when a player has no edited ending stack yet", () => {
    // Only b's ending stack was edited; a keeps its current_stack (10.2M) as the
    // projection. That fallback is BELOW a's own pre-hand leaderboard snapshot
    // (12.3M, chips already committed to this hand's pot) and below b's new 12.5M,
    // so a's provisional rank already drops from 1 to 2 before anyone touches its
    // ending-stack field — mirrors ReviewHandPanel's own `?? current_stack` default.
    const shifts = computeRankShifts(LEADERBOARD, PLAYERS, { b: 12500000 });
    expect(shifts.find((s) => s.player_id === "a")).toEqual({
      player_id: "a",
      seat_number: 1,
      display_name: "GUIDO",
      before: 1,
      after: 2,
    });
    expect(shifts.find((s) => s.player_id === "b")).toEqual({
      player_id: "b",
      seat_number: 2,
      display_name: "KIÊN",
      before: 2,
      after: 1,
    });
  });

  it("a player missing from the leaderboard snapshot is silently skipped (before/after both 0)", () => {
    const shifts = computeRankShifts(
      [{ player_id: "z", chip_count: 1000 }],
      [{ player_id: "unknown", seat_number: 9, display_name: "Ghost", current_stack: 5000 }],
      {}
    );
    expect(shifts).toEqual([]);
  });
});
