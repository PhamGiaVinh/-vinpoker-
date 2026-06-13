import { describe, it, expect } from "vitest";
import {
  reduceHand,
  nextToAct,
  isBettingRoundComplete,
} from "@tracker-engine/handState.ts";
import { computePotBreakdown, contributionsFromActions } from "@tracker-engine/potEngine.ts";
import type { ActionRow, PlayerSeed } from "@tracker-engine/types.ts";

const SEEDS: PlayerSeed[] = [
  { player_id: "P1", seat_number: 1, starting_stack: 10000 },
  { player_id: "P2", seat_number: 2, starting_stack: 10000 },
  { player_id: "P3", seat_number: 3, starting_stack: 10000 },
];
const BUTTON = 1;

function build(rows: [string, ActionRow["action_type"], number, ActionRow["street"]?][]): ActionRow[] {
  return rows.map(([player_id, action_type, action_amount, street], i) => ({
    player_id,
    action_type,
    action_amount,
    street: street ?? "preflop",
    action_order: i + 1,
  }));
}

describe("reduceHand", () => {
  it("reconstructs stacks, commitments and the betting situation", () => {
    const actions = build([
      ["P2", "post_sb", 50],
      ["P3", "post_bb", 100],
      ["P1", "raise", 300],
      ["P2", "call", 250],
      ["P3", "fold", 0],
    ]);
    const rt = reduceHand(SEEDS, actions, BUTTON);
    const byId = Object.fromEntries(rt.players.map((p) => [p.player_id, p]));

    expect(byId.P1).toMatchObject({ street_bet: 300, total_bet: 300, stack: 9700, is_folded: false });
    expect(byId.P2).toMatchObject({ street_bet: 300, total_bet: 300, stack: 9700 });
    expect(byId.P3).toMatchObject({ total_bet: 100, is_folded: true });
    expect(rt.highestBet).toBe(300);
    expect(rt.minRaise).toBe(200); // last full raise increment (300 - 100)
  });

  it("resets street state on a street transition", () => {
    const actions = build([
      ["P2", "post_sb", 50],
      ["P3", "post_bb", 100],
      ["P1", "call", 100],
      ["P2", "call", 50],
      ["P3", "check", 0],
      ["P2", "bet", 200, "flop"],
      ["P3", "call", 200, "flop"],
    ]);
    const rt = reduceHand(SEEDS, actions, BUTTON);
    const byId = Object.fromEntries(rt.players.map((p) => [p.player_id, p]));
    expect(rt.street).toBe("flop");
    expect(rt.highestBet).toBe(200); // street bet, not cumulative
    expect(byId.P2.street_bet).toBe(200);
    expect(byId.P2.total_bet).toBe(300); // 100 preflop + 200 flop
    expect(byId.P1.is_folded).toBe(false);
  });

  it("marks a player all-in when their stack reaches zero", () => {
    const seeds: PlayerSeed[] = [
      { player_id: "P1", seat_number: 1, starting_stack: 500 },
      { player_id: "P2", seat_number: 2, starting_stack: 10000 },
    ];
    const rt = reduceHand(seeds, build([["P1", "all_in", 500]]), BUTTON);
    expect(rt.players.find((p) => p.player_id === "P1")!.is_all_in).toBe(true);
  });
});

describe("nextToAct / isBettingRoundComplete", () => {
  it("UTG acts first after the blinds", () => {
    const actions = build([["P2", "post_sb", 50], ["P3", "post_bb", 100]]);
    expect(nextToAct(SEEDS, actions, BUTTON)).toBe("P1");
  });

  it("returns null and reports complete when everyone has matched", () => {
    const actions = build([
      ["P2", "post_sb", 50],
      ["P3", "post_bb", 100],
      ["P1", "call", 100],
      ["P2", "call", 50],
      ["P3", "check", 0],
    ]);
    expect(nextToAct(SEEDS, actions, BUTTON)).toBeNull();
    expect(isBettingRoundComplete(reduceHand(SEEDS, actions, BUTTON))).toBe(true);
  });

  it("points to the short caller after a raise", () => {
    const actions = build([
      ["P2", "post_sb", 50],
      ["P3", "post_bb", 100],
      ["P1", "raise", 300],
    ]);
    expect(nextToAct(SEEDS, actions, BUTTON)).toBe("P2");
  });
});

describe("stream -> pot integration (positive scenarios)", () => {
  it("short all-in creates a side pot", () => {
    const seeds: PlayerSeed[] = [
      { player_id: "P1", seat_number: 1, starting_stack: 500 },
      { player_id: "P2", seat_number: 2, starting_stack: 10000 },
      { player_id: "P3", seat_number: 3, starting_stack: 10000 },
    ];
    const actions = build([
      ["P1", "all_in", 500],
      ["P2", "call", 1000],
      ["P3", "call", 1000],
    ]);
    const rt = reduceHand(seeds, actions, BUTTON);
    expect(rt.players.find((p) => p.player_id === "P1")!.is_all_in).toBe(true);

    const breakdown = computePotBreakdown(contributionsFromActions(actions));
    expect(breakdown.mainPot).toBe(1500);
    expect(breakdown.sidePots).toHaveLength(1);
    expect(breakdown.sidePots[0].amount).toBe(1000);
    expect(breakdown.sidePots[0].eligible_player_ids.sort()).toEqual(["P2", "P3"]);
  });

  it("uncalled bet is returned (not in the pot)", () => {
    const actions = build([
      ["P1", "bet", 1000, "flop"],
      ["P2", "call", 400, "flop"], // short all-in call
      ["P3", "fold", 0, "flop"],
    ]);
    const breakdown = computePotBreakdown(contributionsFromActions(actions));
    expect(breakdown.uncalled).toEqual({ player_id: "P1", amount: 600 });
    expect(breakdown.totalPot).toBe(800); // 400 x 2
  });

  it("folded dead money stays in the pot but the folder is not eligible", () => {
    const actions = build([
      ["P1", "bet", 300, "flop"],
      ["P2", "call", 300, "flop"],
      ["P3", "fold", 0, "flop"], // P3 had put 300 preflop
      ["P3", "post_bb", 300], // preflop contribution
    ]);
    const breakdown = computePotBreakdown(contributionsFromActions(actions));
    // P3's 300 is dead money; P1/P2 contest, P3 not eligible anywhere.
    const allEligible = breakdown.pots.flatMap((p) => p.eligible_player_ids);
    expect(allEligible).not.toContain("P3");
    expect(breakdown.totalCommitted).toBe(900);
  });
});
