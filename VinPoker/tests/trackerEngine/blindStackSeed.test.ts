// Regression for the P0 tracker bug: "Không có cược nào để call" on a legal UTG call.
//
// Root cause was NOT the engine — it was the SEED: start_hand read each player's
// stack from tournament_chip_counts (COALESCE(cc.chip_count, 0)), so when a player
// had no chip-count row, hand_players.starting_stack = 0. The server reducer
// (handState.ts) then clamps a blind post to min(amount, stack) = 0, leaving
// highestBet = 0, so validateAction (enforce mode) rejects the legal UTG call with
// CALL_WITH_NOTHING_TO_CALL. Migration 20260930000000 fixes the seed
// (COALESCE(cc.chip_count, ts.chip_count, 0)); these tests pin both the correct
// behavior with real stacks AND the exact failure mode the seed produced.

import { describe, it, expect } from "vitest";
import { validateAction } from "@tracker-engine/validateAction.ts";
import { reduceHand } from "@tracker-engine/handState.ts";
import type { ActionRow, PlayerSeed } from "@tracker-engine/types.ts";

// 3-handed: button seat 1, SB seat 2, BB seat 3. After blinds, UTG = seat 1 (button).
const BUTTON = 1;
const seeds = (stack: number): PlayerSeed[] => [
  { player_id: "P1", seat_number: 1, starting_stack: stack },
  { player_id: "P2", seat_number: 2, starting_stack: stack },
  { player_id: "P3", seat_number: 3, starting_stack: stack },
];
const BLINDS: ActionRow[] = [
  { player_id: "P2", street: "preflop", action_type: "post_sb", action_amount: 50, action_order: 1 },
  { player_id: "P3", street: "preflop", action_type: "post_bb", action_amount: 100, action_order: 2 },
];
const utgCall: ActionRow = {
  player_id: "P1", street: "preflop", action_type: "call", action_amount: 100, action_order: 3,
};

describe("tracker preflop legality after blinds (starting_stack seed regression)", () => {
  it("with real stacks, blinds raise highestBet to the BB", () => {
    const rt = reduceHand(seeds(10000), BLINDS, BUTTON);
    expect(rt.highestBet).toBe(100);
    expect(rt.bigBlind).toBe(100);
  });

  it("1. UTG facing the BB can CALL 1BB", () => {
    const r = validateAction(seeds(10000), BLINDS, BUTTON, utgCall);
    expect(r.valid).toBe(true);
    expect(r.normalizedAmount).toBe(100);
  });

  it("2. UTG can RAISE over the BB", () => {
    const r = validateAction(seeds(10000), BLINDS, BUTTON, {
      player_id: "P1", street: "preflop", action_type: "raise", action_amount: 300, action_order: 3,
    });
    expect(r.valid).toBe(true);
  });

  it("3. UTG can ALL-IN", () => {
    const r = validateAction(seeds(10000), BLINDS, BUTTON, {
      player_id: "P1", street: "preflop", action_type: "all_in", action_amount: 10000, action_order: 3,
    });
    expect(r.valid).toBe(true);
  });

  it("4. a player with nothing to call cannot CALL (must Check)", () => {
    // P1 calls 100, P2 completes the SB → the BB (P3) now faces no bet (toCall 0).
    const rows: ActionRow[] = [
      ...BLINDS,
      { player_id: "P1", street: "preflop", action_type: "call", action_amount: 100, action_order: 3 },
      { player_id: "P2", street: "preflop", action_type: "call", action_amount: 50, action_order: 4 },
    ];
    const badCall = validateAction(seeds(10000), rows, BUTTON, {
      player_id: "P3", street: "preflop", action_type: "call", action_amount: 0, action_order: 5,
    });
    expect(badCall.valid).toBe(false);
    expect(badCall.code).toBe("CALL_WITH_NOTHING_TO_CALL");

    const check = validateAction(seeds(10000), rows, BUTTON, {
      player_id: "P3", street: "preflop", action_type: "check", action_amount: 0, action_order: 5,
    });
    expect(check.valid).toBe(true);
  });

  it("ROOT CAUSE: starting_stack = 0 clamps blinds to 0 → the legal UTG call is wrongly rejected (what migration 20260930000000 prevents)", () => {
    const rt = reduceHand(seeds(0), BLINDS, BUTTON);
    expect(rt.highestBet).toBe(0); // blinds swallowed by the min(amount, stack=0) clamp

    const r = validateAction(seeds(0), BLINDS, BUTTON, utgCall);
    expect(r.valid).toBe(false);
    expect(r.code).toBe("CALL_WITH_NOTHING_TO_CALL");
  });
});
