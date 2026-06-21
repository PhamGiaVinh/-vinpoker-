// P2-5 DB-1 — TDA forward-moving (dead) button SUGGESTION + the bbSeatOverride
// sufficiency proof.
//
// RULE under test (`nextButtonTournament`): the BB advances to the next LIVE seat
// after the previous BB (never dead); the SB is one physical seat before the BB and
// the button one physical seat before the SB — either may land on an EMPTY seat
// (dead button / dead SB). Heads-up: button = SB, blinds swap each hand.
//
// 🔴 SUFFICIENCY GATE (Part B): the engine honors the dead-button BB via the
// additive `EngineState.bbSeatOverride` ONLY (no `sbSeatOverride`). Part B proves
// that suffices even in the hard case where the dead-button SB is an OCCUPIED seat
// DIFFERENT from `blindSeats(occupied, button)`'s pick — because the first-actor
// seed needs only the BB, and the SB-owed check is GLOBAL on `sbPosted`.

import { describe, it, expect } from "vitest";
import { nextButtonTournament } from "@/lib/tournament/deadButton";
import { actorToAct, isRoundComplete, type EngineSeat, type EngineState } from "@/lib/tracker-poker/trackerEngine";

// ---------- Part A — the dead-button suggestion (full bust matrix) ----------
// Prior hand on a 6-max: button=1, SB=2, BB=3 (so prevBbSeat = 3).
describe("P2-5 nextButtonTournament — TDA forward-moving (dead) button", () => {
  const six = (occupied: number[], prevBbSeat: number | null) =>
    nextButtonTournament({ maxSeats: 6, occupiedSeats: occupied, prevBbSeat });

  it("no bust: blinds + button each advance one live seat", () => {
    expect(six([1, 2, 3, 4, 5, 6], 3)).toEqual({ buttonSeat: 2, sbSeat: 3, bbSeat: 4, deadButton: false, deadSb: false });
  });

  it("bust the BUTTON (seat 1): no dead — button/SB/BB are all live", () => {
    expect(six([2, 3, 4, 5, 6], 3)).toEqual({ buttonSeat: 2, sbSeat: 3, bbSeat: 4, deadButton: false, deadSb: false });
  });

  it("bust the SB (seat 2): DEAD BUTTON on the empty SB-1 seat", () => {
    expect(six([1, 3, 4, 5, 6], 3)).toEqual({ buttonSeat: 2, sbSeat: 3, bbSeat: 4, deadButton: true, deadSb: false });
  });

  it("bust the BB (seat 3): BB advances to 4, the old-BB seat is the DEAD SB", () => {
    expect(six([1, 2, 4, 5, 6], 3)).toEqual({ buttonSeat: 2, sbSeat: null, bbSeat: 4, deadButton: false, deadSb: true });
  });

  it("consecutive busts between button↔BB (2 and 3 gone): DEAD button AND DEAD SB", () => {
    expect(six([1, 4, 5, 6], 3)).toEqual({ buttonSeat: 2, sbSeat: null, bbSeat: 4, deadButton: true, deadSb: true });
  });

  it("3-handed → heads-up: button = SB = the prev BB, BB = the other live seat", () => {
    expect(six([3, 4], 3)).toEqual({ buttonSeat: 3, sbSeat: 3, bbSeat: 4, deadButton: false, deadSb: false });
  });

  it("heads-up edge: blinds swap (prevBb=4 → button 4, BB 3)", () => {
    expect(six([3, 4], 4)).toEqual({ buttonSeat: 4, sbSeat: 4, bbSeat: 3, deadButton: false, deadSb: false });
  });

  it("BB advances with wrap-around (prevBb is the highest live seat)", () => {
    // prevBb=6 → next live after 6 wraps to 1; SB=ringPrev(1)=6, button=ringPrev(6)=5.
    expect(six([1, 2, 3, 4, 5, 6], 6)).toEqual({ buttonSeat: 5, sbSeat: 6, bbSeat: 1, deadButton: false, deadSb: false });
  });

  it("no suggestion when <2 live or first hand (operator sets the button)", () => {
    expect(six([4], 3)).toBeNull();
    expect(six([1, 2, 3], null)).toBeNull();
  });
});

// ---------- Part B — bbSeatOverride sufficiency proof ----------
// 9-max, live seats {2,3,5,8} (gaps at 1,4,6,7,9), prevBb=2.
//   nextButtonTournament → button=1 (DEAD), SB=2 (LIVE), BB=3.
//   blindSeats([2,3,5,8], button=1) → sbSeat=3, bbSeat=5  ← DIFFERENT from the
//   dead-button SB=2 / BB=3. This is the hard case the gate must clear.
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

describe("P2-5 bbSeatOverride sufficiency (SB occupied ≠ blindSeats pick)", () => {
  const occupied = [2, 3, 5, 8];

  it("the suggestion's SB/BB differ from blindSeats — establishing the hard case", () => {
    const sug = nextButtonTournament({ maxSeats: 9, occupiedSeats: occupied, prevBbSeat: 2 })!;
    expect(sug).toEqual({ buttonSeat: 1, sbSeat: 2, bbSeat: 3, deadButton: true, deadSb: false });
  });

  it("WITHOUT bbSeatOverride the first preflop actor is WRONG (blindSeats BB=5 → UTG 8)", () => {
    const state: EngineState = {
      seats: [seat(2, { street_committed: 50, total_committed: 50 }), seat(3, { street_committed: 100, total_committed: 100 }), seat(5), seat(8)],
      buttonSeat: 1, // dead button
      street: "preflop",
      bigBlind: 100,
      streetActions: [
        { player_id: "P2", seat_number: 2, action_type: "post_sb" },
        { player_id: "P3", seat_number: 3, action_type: "post_bb" },
      ],
    };
    expect(actorToAct(state)?.seat_number).toBe(8); // blindSeats BB=5 → seed 5 → UTG 8 (WRONG)
  });

  it("WITH bbSeatOverride=3 the first preflop actor is CORRECT (UTG = seat 5, left of real BB 3)", () => {
    const state: EngineState = {
      seats: [seat(2, { street_committed: 50, total_committed: 50 }), seat(3, { street_committed: 100, total_committed: 100 }), seat(5), seat(8)],
      buttonSeat: 1,
      street: "preflop",
      bigBlind: 100,
      bbSeatOverride: 3, // the dead-button BB
      streetActions: [
        { player_id: "P2", seat_number: 2, action_type: "post_sb" },
        { player_id: "P3", seat_number: 3, action_type: "post_bb" },
      ],
    };
    expect(actorToAct(state)?.seat_number).toBe(5); // CORRECT — proves bbSeatOverride alone fixes the actor order
  });

  it("WITH bbSeatOverride the BB post is prompted on the real BB (seat 3), not blindSeats' seat 5", () => {
    const state: EngineState = {
      seats: [seat(2), seat(3), seat(5), seat(8)],
      buttonSeat: 1,
      street: "preflop",
      bigBlind: 100,
      deadSb: true, // ignore the SB post for this check; isolate the BB prompt
      bbSeatOverride: 3,
      streetActions: [],
    };
    const a = actorToAct(state);
    expect(a?.seat_number).toBe(3);
    expect(a?.needsPost).toBe("post_bb");
  });

  it("isRoundComplete: the wrong blindSeats SB seat does NOT block (sbPosted is global) — bbSeatOverride suffices", () => {
    // Full preflop, everyone to 100, all acted. blindSeats sbSeat=3 / bbSeat=5 are
    // both "wrong", but the SB check keys off the GLOBAL post_sb and the BB check
    // uses the override → the round completes.
    const settled: EngineState = {
      seats: [
        seat(2, { street_committed: 100, total_committed: 100 }),
        seat(3, { street_committed: 100, total_committed: 100 }),
        seat(5, { street_committed: 100, total_committed: 100 }),
        seat(8, { street_committed: 100, total_committed: 100 }),
      ],
      buttonSeat: 1,
      street: "preflop",
      bigBlind: 100,
      bbSeatOverride: 3,
      streetActions: [
        { player_id: "P2", seat_number: 2, action_type: "post_sb" },
        { player_id: "P3", seat_number: 3, action_type: "post_bb" },
        { player_id: "P5", seat_number: 5, action_type: "call" },
        { player_id: "P8", seat_number: 8, action_type: "call" },
        { player_id: "P2", seat_number: 2, action_type: "call" },
        { player_id: "P3", seat_number: 3, action_type: "check" },
      ],
    };
    expect(isRoundComplete(settled)).toBe(true);
  });

  it("default (no bbSeatOverride) is unchanged — blindSeats drives everything", () => {
    const state: EngineState = { seats: [seat(1), seat(2), seat(3)], buttonSeat: 1, street: "preflop", streetActions: [] };
    // blindSeats([1,2,3],1) → SB=2, BB=3; first prompt is the SB post on seat 2.
    expect(actorToAct(state)?.needsPost).toBe("post_sb");
    expect(actorToAct(state)?.seat_number).toBe(2);
  });
});
