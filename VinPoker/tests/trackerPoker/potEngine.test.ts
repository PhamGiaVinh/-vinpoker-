import { describe, it, expect } from "vitest";
import {
  computePotBreakdown,
  contributionsFromActions,
  toSidePotsJson,
  type PotContributor,
} from "@/lib/tracker-poker/potEngine";

const p = (player_id: string, total_bet: number, is_folded = false): PotContributor => ({
  player_id,
  total_bet,
  is_folded,
});

const conservation = (contributors: PotContributor[]) => {
  const b = computePotBreakdown(contributors);
  const committed = contributors.reduce(
    (s, c) => s + Math.max(0, Math.floor(Number.isFinite(c.total_bet) ? c.total_bet : 0)),
    0
  );
  expect(b.totalPot + (b.uncalled?.amount ?? 0)).toBe(committed);
  expect(b.totalCommitted).toBe(committed);
  return b;
};

describe("computePotBreakdown", () => {
  it("no all-in: single main pot, all non-folded eligible", () => {
    const b = conservation([p("A", 100), p("B", 100), p("C", 100)]);
    expect(b.pots).toHaveLength(1);
    expect(b.mainPot).toBe(300);
    expect(b.sidePots).toHaveLength(0);
    expect(b.uncalled).toBeNull();
    expect(b.pots[0].eligible_player_ids.sort()).toEqual(["A", "B", "C"]);
  });

  it("one short all-in: main pot + one side pot", () => {
    // A all-in 500, B and C call 1000 each
    const b = conservation([p("A", 500), p("B", 1000), p("C", 1000)]);
    expect(b.pots).toHaveLength(2);
    expect(b.mainPot).toBe(1500); // 500 x 3
    expect(b.sidePots[0].amount).toBe(1000); // 500 x 2
    expect(b.pots[0].eligible_player_ids.sort()).toEqual(["A", "B", "C"]);
    expect(b.sidePots[0].eligible_player_ids.sort()).toEqual(["B", "C"]);
    expect(b.uncalled).toBeNull();
  });

  it("multiple all-ins at different caps: multiple side pots", () => {
    // A all-in 200, B all-in 500, C and D commit 1000
    const b = conservation([p("A", 200), p("B", 500), p("C", 1000), p("D", 1000)]);
    expect(b.pots).toHaveLength(3);
    expect(b.pots[0].amount).toBe(800); // 200 x 4
    expect(b.pots[1].amount).toBe(900); // 300 x 3
    expect(b.pots[2].amount).toBe(1000); // 500 x 2
    expect(b.pots[0].eligible_player_ids.sort()).toEqual(["A", "B", "C", "D"]);
    expect(b.pots[1].eligible_player_ids.sort()).toEqual(["B", "C", "D"]);
    expect(b.pots[2].eligible_player_ids.sort()).toEqual(["C", "D"]);
  });

  it("two all-ins at the SAME cap merge into one layer", () => {
    const b = conservation([p("A", 500), p("B", 500), p("C", 500)]);
    expect(b.pots).toHaveLength(1);
    expect(b.mainPot).toBe(1500);
  });

  it("folded player's chips stay in the pot but they are never eligible", () => {
    // C folds after putting in 300; A all-in 500, B calls 500.
    // C's 300-level must NOT split the pot — same eligible set merges into one pot.
    const b = conservation([p("A", 500), p("B", 500), p("C", 300, true)]);
    expect(b.pots).toHaveLength(1);
    expect(b.mainPot).toBe(1300); // 300x3 dead-money layer + 200x2, merged
    expect(b.pots[0].eligible_player_ids.sort()).toEqual(["A", "B"]);
    expect(b.uncalled).toBeNull();
  });

  it("uncalled bet is detected and excluded from the pot layers", () => {
    // A bets 1000, B calls all-in for 400, C folded 100 in.
    // After A's 600 refund, A and B are both at 400 — single pot, no side pot.
    const b = conservation([p("A", 1000), p("B", 400), p("C", 100, true)]);
    expect(b.uncalled).toEqual({ player_id: "A", amount: 600 });
    expect(b.pots).toHaveLength(1);
    expect(b.mainPot).toBe(900); // 100x3 + 300x2, merged (same eligible set)
    expect(b.totalPot).toBe(900); // 1500 committed - 600 refund
  });

  it("a live short all-in below a folded contribution still splits the pot", () => {
    // A all-in 200, B commits 500, C folded 500 in: eligibility differs at 200 cap
    const b = conservation([p("A", 200), p("B", 500), p("C", 500, true)]);
    expect(b.pots).toHaveLength(2);
    expect(b.pots[0].amount).toBe(600); // 200 x 3, eligible A + B
    expect(b.pots[0].eligible_player_ids.sort()).toEqual(["A", "B"]);
    expect(b.pots[1].amount).toBe(600); // 300 x 2 (B live, C dead money)
    expect(b.pots[1].eligible_player_ids).toEqual(["B"]);
  });

  it("uncalled bet is NOT refunded to a folded over-contributor (dead money)", () => {
    // Operator-entry edge: top contributor folded — chips stay in the pot
    const b = conservation([p("A", 1000, true), p("B", 400)]);
    expect(b.uncalled).toBeNull();
    expect(b.totalPot).toBe(1400);
    // top layer has no eligible player (impossible in legal play; T4 validation)
    expect(b.pots[1].eligible_player_ids).toEqual([]);
  });

  it("single contributor: everything is uncalled (full refund), no pots", () => {
    const b = conservation([p("A", 300), p("B", 0)]);
    expect(b.uncalled).toEqual({ player_id: "A", amount: 300 });
    expect(b.pots).toHaveLength(0);
    expect(b.totalPot).toBe(0);
  });

  it("zero/invalid inputs: empty, negative, NaN are safe", () => {
    expect(computePotBreakdown([])).toMatchObject({ pots: [], totalPot: 0, uncalled: null });
    expect(computePotBreakdown([p("A", 0), p("B", -50)])).toMatchObject({
      pots: [],
      totalPot: 0,
    });
    const b = conservation([p("A", Number.NaN), p("B", 100), p("C", 100)]);
    expect(b.mainPot).toBe(200);
  });

  it("fractional chip counts are floored", () => {
    const b = computePotBreakdown([p("A", 100.9), p("B", 100.2)]);
    expect(b.mainPot).toBe(200);
  });
});

describe("contributionsFromActions", () => {
  it("accumulates contributing actions across streets and tracks folds", () => {
    const contributors = contributionsFromActions([
      { player_id: "A", action_type: "post_sb", action_amount: 50 },
      { player_id: "B", action_type: "post_bb", action_amount: 100 },
      { player_id: "C", action_type: "call", action_amount: 100 },
      { player_id: "A", action_type: "raise", action_amount: 250 },
      { player_id: "B", action_type: "fold", action_amount: 0 },
      { player_id: "C", action_type: "all_in", action_amount: 400 },
      { player_id: "A", action_type: "call", action_amount: 200 },
      { player_id: "C", action_type: "check", action_amount: null },
    ]);
    const byId = Object.fromEntries(contributors.map((c) => [c.player_id, c]));
    expect(byId.A).toMatchObject({ total_bet: 500, is_folded: false });
    expect(byId.B).toMatchObject({ total_bet: 100, is_folded: true });
    expect(byId.C).toMatchObject({ total_bet: 500, is_folded: false });

    const b = computePotBreakdown(contributors);
    expect(b.pots).toHaveLength(1); // equal caps, B's 100 is dead money
    expect(b.mainPot).toBe(1100);
    expect(b.pots[0].eligible_player_ids.sort()).toEqual(["A", "C"]);
  });

  it("ignores non-contributing actions and null amounts", () => {
    const contributors = contributionsFromActions([
      { player_id: "A", action_type: "check", action_amount: null },
      { player_id: "A", action_type: "bet", action_amount: null },
    ]);
    expect(contributors[0].total_bet).toBe(0);
  });
});

describe("toSidePotsJson", () => {
  it("serializes all layers (main first) for record_hand p_side_pots", () => {
    const json = toSidePotsJson(computePotBreakdown([p("A", 500), p("B", 1000), p("C", 1000)]));
    expect(json).toEqual([
      { amount: 1500, eligible_player_ids: expect.arrayContaining(["A", "B", "C"]) },
      { amount: 1000, eligible_player_ids: expect.arrayContaining(["B", "C"]) },
    ]);
  });

  it("empty breakdown serializes to []", () => {
    expect(toSidePotsJson(computePotBreakdown([]))).toEqual([]);
  });
});
