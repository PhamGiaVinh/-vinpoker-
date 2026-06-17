import { describe, it, expect } from "vitest";
import {
  deriveHandBreakdown,
  type BreakdownAction,
} from "@/lib/tracker-poker/handBreakdown";

// A small heads-up hand. action_amount = chips ADDED that street.
//   preflop pot = 25 + 50 + 150 + 125            = 350
//   flop    pot = 350 + 0(check) + 200 + 200     = 750
//   turn    pot = 750 + 500 + 500                = 1750
//   river   pot = 1750 + 1000 + 0(fold)          = 2750
const ACTIONS: BreakdownAction[] = [
  { player_id: "p1", street: "preflop", action_type: "post_sb", action_amount: 25, action_order: 1 },
  { player_id: "p2", street: "preflop", action_type: "post_bb", action_amount: 50, action_order: 2 },
  { player_id: "p1", street: "preflop", action_type: "raise", action_amount: 150, action_order: 3 },
  { player_id: "p2", street: "preflop", action_type: "call", action_amount: 125, action_order: 4 },
  { player_id: "p2", street: "flop", action_type: "check", action_amount: null, action_order: 5 },
  { player_id: "p1", street: "flop", action_type: "bet", action_amount: 200, action_order: 6 },
  { player_id: "p2", street: "flop", action_type: "call", action_amount: 200, action_order: 7 },
  { player_id: "p2", street: "turn", action_type: "bet", action_amount: 500, action_order: 8 },
  { player_id: "p1", street: "turn", action_type: "call", action_amount: 500, action_order: 9 },
  { player_id: "p1", street: "river", action_type: "all_in", action_amount: 1000, action_order: 10 },
  { player_id: "p2", street: "river", action_type: "fold", action_amount: null, action_order: 11 },
];

describe("deriveHandBreakdown", () => {
  it("groups present streets in order, omitting empty ones (no showdown here)", () => {
    const out = deriveHandBreakdown(ACTIONS, 50);
    expect(out.map((s) => s.street)).toEqual(["preflop", "flop", "turn", "river"]);
  });

  it("computes the CUMULATIVE pot through the end of each street (chips + BB)", () => {
    const out = deriveHandBreakdown(ACTIONS, 50);
    const byStreet = Object.fromEntries(out.map((s) => [s.street, s]));
    expect(byStreet.preflop.potChips).toBe(350);
    expect(byStreet.flop.potChips).toBe(750);
    expect(byStreet.turn.potChips).toBe(1750);
    expect(byStreet.river.potChips).toBe(2750);
    // BB = chips / bigBlind
    expect(byStreet.preflop.potBB).toBe(7); // 350/50
    expect(byStreet.river.potBB).toBe(55); // 2750/50
  });

  it("sorts rows within a street by action_order even when input is shuffled", () => {
    const shuffled = [...ACTIONS].reverse();
    const out = deriveHandBreakdown(shuffled, 50);
    const preflop = out.find((s) => s.street === "preflop")!;
    expect(preflop.rows.map((r) => r.action_order)).toEqual([1, 2, 3, 4]);
  });

  it("coerces null action_amount to 0 and gives no BB for zero-amount actions", () => {
    const out = deriveHandBreakdown(ACTIONS, 50);
    const river = out.find((s) => s.street === "river")!;
    const fold = river.rows.find((r) => r.action_type === "fold")!;
    expect(fold.action_amount).toBe(0);
    expect(fold.amountBB).toBeNull();
    expect(fold.label).toBe("Fold");
  });

  it("converts chip amounts to big blinds and builds a readable label", () => {
    const out = deriveHandBreakdown(ACTIONS, 50);
    const flop = out.find((s) => s.street === "flop")!;
    const bet = flop.rows.find((r) => r.action_type === "bet")!;
    expect(bet.action_amount).toBe(200);
    expect(bet.amountBB).toBe(4); // 200/50
    expect(bet.label).toBe("Bet 200");
    // fractional conversion keeps one decimal
    const preflop = out.find((s) => s.street === "preflop")!;
    const call = preflop.rows.find((r) => r.action_type === "call")!;
    expect(call.amountBB).toBe(2.5); // 125/50
  });

  it("with bigBlind <= 0 returns chips only (all BB fields null)", () => {
    const out = deriveHandBreakdown(ACTIONS, 0);
    expect(out.every((s) => s.potBB === null)).toBe(true);
    expect(out.every((s) => s.rows.every((r) => r.amountBB === null))).toBe(true);
    // pot chips are still computed
    expect(out.find((s) => s.street === "river")!.potChips).toBe(2750);
  });

  it("returns an empty array when there are no actions", () => {
    expect(deriveHandBreakdown([], 50)).toEqual([]);
  });
});
