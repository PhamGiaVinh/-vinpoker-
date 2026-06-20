// P2-3 — dead small blind (additive engine flag). With `state.deadSb`, the engine
// neither PROMPTS the SB post (actorToAct) nor REQUIRES it before the preflop round
// can complete (isRoundComplete). Default (flag unset) ⇒ the normal SB-required
// behavior, so the old embedded tab and the normal flow are unchanged.
//
// blindSeats is NOT touched — the flag only gates the two preflop spots that read
// the SB obligation. Pure functions, no DB.

import { describe, it, expect } from "vitest";
import {
  actorToAct,
  isRoundComplete,
  type EngineSeat,
  type EngineState,
} from "@/lib/tracker-poker/trackerEngine";

function seat(seat_number: number, over: Partial<EngineSeat> = {}): EngineSeat {
  return {
    player_id: `P${seat_number}`,
    seat_number,
    starting_stack: 1000,
    stack: 1000,
    street_committed: 0,
    total_committed: 0,
    folded: false,
    all_in: false,
    ...over,
  };
}

// 3-handed, button=1 ⇒ blindSeats picks SB=2, BB=3.
const seats3 = [seat(1), seat(2), seat(3)];

describe("P2-3 dead small blind", () => {
  it("actorToAct: WITHOUT deadSb, prompts the SB post first (normal)", () => {
    const state: EngineState = { seats: seats3, buttonSeat: 1, street: "preflop", streetActions: [] };
    const a = actorToAct(state);
    expect(a?.seat_number).toBe(2);
    expect(a?.needsPost).toBe("post_sb");
  });

  it("actorToAct: WITH deadSb, skips the SB and prompts the BB post", () => {
    const state: EngineState = { seats: seats3, buttonSeat: 1, street: "preflop", streetActions: [], deadSb: true };
    const a = actorToAct(state);
    expect(a?.seat_number).toBe(3);
    expect(a?.needsPost).toBe("post_bb");
  });

  it("actorToAct: WITH deadSb + BB posted, first voluntary actor is UTG (left of BB), no SB owed", () => {
    const state: EngineState = {
      seats: [seat(1), seat(2), seat(3, { street_committed: 100, total_committed: 100 })],
      buttonSeat: 1,
      street: "preflop",
      bigBlind: 100,
      deadSb: true,
      streetActions: [{ player_id: "P3", seat_number: 3, action_type: "post_bb" }],
    };
    const a = actorToAct(state);
    expect(a?.seat_number).toBe(1); // UTG acts; never prompted to post an SB
    expect(a?.needsPost).toBeUndefined();
  });

  it("isRoundComplete: WITH deadSb, a no-SB preflop completes once BB posted + everyone acted", () => {
    // BB(3) posted, SB(2) never posts (dead), all called/checked to 100.
    const acted = [
      { player_id: "P3", seat_number: 3, action_type: "post_bb" },
      { player_id: "P1", seat_number: 1, action_type: "call" },
      { player_id: "P2", seat_number: 2, action_type: "call" },
      { player_id: "P3", seat_number: 3, action_type: "check" },
    ];
    const settled = [
      seat(1, { street_committed: 100, total_committed: 100 }),
      seat(2, { street_committed: 100, total_committed: 100 }),
      seat(3, { street_committed: 100, total_committed: 100 }),
    ];
    const deadState: EngineState = { seats: settled, buttonSeat: 1, street: "preflop", bigBlind: 100, deadSb: true, streetActions: acted };
    expect(isRoundComplete(deadState)).toBe(true);

    // Same position WITHOUT deadSb ⇒ the SB (seat 2) is still owed a post ⇒ not complete.
    const normalState: EngineState = { ...deadState, deadSb: false };
    expect(isRoundComplete(normalState)).toBe(false);
  });

  it("default (flag unset) is byte-equivalent to deadSb:false — SB still required", () => {
    const base: EngineState = { seats: seats3, buttonSeat: 1, street: "preflop", streetActions: [] };
    expect(actorToAct(base)?.needsPost).toBe("post_sb");
    expect(actorToAct({ ...base, deadSb: false })?.needsPost).toBe("post_sb");
  });
});
