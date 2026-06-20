// Rules-pin (PR-T): pot layering + the SPEC for the known settlement gap.
// `computePotBreakdown` (server) layers side pots correctly TODAY (regression
// guards pass). `settleSelectedWinners` (client) does NOT yet pay per layer — that
// is pinned as a SKIP spec so the expected-correct payout is on record.
// Pure; no DB, no source change.
import { describe, it, expect } from "vitest";
import { computePotBreakdown, type PotContributor } from "@tracker-engine/potEngine.ts";
import { settleSelectedWinners, type EngineSeat } from "@/lib/tracker-poker/trackerEngine";

describe("computePotBreakdown — multiway side pots (regression guard)", () => {
  it("100 / 300 / 500 all-in → main + one side pot, top bet refunded", () => {
    const contributors: PotContributor[] = [
      { player_id: "A", total_bet: 100, is_folded: false },
      { player_id: "B", total_bet: 300, is_folded: false },
      { player_id: "C", total_bet: 500, is_folded: false },
    ];
    const b = computePotBreakdown(contributors);
    expect(b.uncalled).toEqual({ player_id: "C", amount: 200 });
    expect(b.pots).toEqual([
      { amount: 300, eligible_player_ids: ["A", "B", "C"] }, // main: everyone
      { amount: 400, eligible_player_ids: ["B", "C"] },       // side: B & C only
    ]);
    expect(b.mainPot).toBe(300);
    expect(b.totalPot).toBe(700);
    expect(b.totalCommitted).toBe(900);
  });

  it("a folded contributor's chips are dead money — in the pot, not eligible", () => {
    const contributors: PotContributor[] = [
      { player_id: "B", total_bet: 300, is_folded: false },
      { player_id: "C", total_bet: 500, is_folded: false },
      { player_id: "D", total_bet: 100, is_folded: true }, // folded after committing 100
    ];
    const b = computePotBreakdown(contributors);
    expect(b.pots.flatMap((p) => p.eligible_player_ids)).not.toContain("D");
    expect(b.uncalled).toEqual({ player_id: "C", amount: 200 });
    expect(b.totalCommitted).toBe(900); // D's 100 counts toward chips committed
    expect(b.totalPot).toBe(700);       // …and stays in the pot as dead money
  });
});

describe("settlement — SPEC (known gap, PENDING Phase-2 side-pot settlement)", () => {
  // Same 100/300/500 all-in. A is eligible ONLY for the main pot (300). If the
  // operator picks A as the winner, A must receive exactly the main pot, not the
  // whole 900. `settleSelectedWinners` currently splits the WHOLE pot to the chosen
  // winner(s) (it ignores potEngine's layers). When per-layer settlement lands,
  // drop `.skip`.
  it.skip("a winner only eligible for the main pot does NOT collect the side pot", () => {
    const seats: EngineSeat[] = [
      { player_id: "A", seat_number: 1, starting_stack: 100, stack: 0, street_committed: 100, total_committed: 100, folded: false, all_in: true },
      { player_id: "B", seat_number: 2, starting_stack: 300, stack: 0, street_committed: 300, total_committed: 300, folded: false, all_in: true },
      { player_id: "C", seat_number: 3, starting_stack: 500, stack: 0, street_committed: 500, total_committed: 500, folded: false, all_in: true },
    ];
    const result = settleSelectedWinners(seats, ["A"]);
    const a = result.find((r) => r.player_id === "A")!;
    expect(a.ending_stack).toBe(300); // EXPECTED: main pot only (currently 900)
  });
});
