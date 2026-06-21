// P2-2 — all-in runout "reveal-first" workflow ordering.
//
// When an all-in + call closes betting before the river, the live procedure is:
// players FLIP hole cards FIRST, THEN the dealer runs out the remaining board,
// THEN settle. These tests pin that ordering on the pure FSM
// (`deriveTrackerWorkflowState`): the new `runout_reveal` state appears once when
// betting closes with board streets remaining, and the reveal happens BEFORE the
// enter_* board streets — for a turn all-in AND (owner-required) a flop all-in.
//
// They also pin the guards: an uncalled all-in mid-street (bettingClosed=false)
// does NOT trigger the reveal; review/submit always wins; and omitting the new
// optional inputs (the old embedded tab) never enters the runout state.

import { describe, it, expect } from "vitest";
import {
  deriveTrackerWorkflowState,
  type TrackerWorkflowInput,
  type WorkflowStreet,
} from "@/components/cashier/tournament-live/handinput/trackerWorkflow";

/** A mid-hand input with sensible defaults; override per case. */
function build(over: Partial<TrackerWorkflowInput> = {}): TrackerWorkflowInput {
  return {
    handStarted: true,
    blindsConfirmed: true,
    currentStreet: "turn",
    persistedBoardCount: 4,
    isReview: false,
    reviewValid: false,
    submitted: false,
    isRunout: false,
    bettingClosed: false,
    revealDone: false,
    ...over,
  };
}

const state = (over: Partial<TrackerWorkflowInput>) => deriveTrackerWorkflowState(build(over));

describe("P2-2 all-in runout reveal-first ordering", () => {
  it("turn all-in: reveal FIRST, then enter_river, then showdown", () => {
    // betting closed on the turn (all-in+call); river board still to come
    expect(
      state({ currentStreet: "river", persistedBoardCount: 4, isRunout: true, bettingClosed: true, revealDone: false }),
    ).toBe("runout_reveal");
    // operator flipped → now enter the river board
    expect(
      state({ currentStreet: "river", persistedBoardCount: 4, isRunout: true, bettingClosed: true, revealDone: true }),
    ).toBe("enter_river");
    // river persisted (5) → settle at showdown
    expect(
      state({ currentStreet: "showdown", persistedBoardCount: 5, isRunout: true, bettingClosed: true, revealDone: true }),
    ).toBe("showdown_input");
  });

  it("flop all-in: reveal ONCE, then enter_turn → enter_river → showdown (2 streets after reveal)", () => {
    const flop = { isRunout: true, bettingClosed: true } as const;
    // betting closed on the flop; turn + river still to come → reveal first
    expect(state({ ...flop, currentStreet: "turn", persistedBoardCount: 3, revealDone: false })).toBe("runout_reveal");
    // reveal done ONCE → enter the turn board
    expect(state({ ...flop, currentStreet: "turn", persistedBoardCount: 3, revealDone: true })).toBe("enter_turn");
    // turn persisted (4) → enter the river board (still revealDone, no second reveal)
    expect(state({ ...flop, currentStreet: "river", persistedBoardCount: 4, revealDone: true })).toBe("enter_river");
    // river persisted (5) → showdown
    expect(state({ ...flop, currentStreet: "showdown", persistedBoardCount: 5, revealDone: true })).toBe("showdown_input");
  });

  it("preflop all-in: reveal before the flop, then enter_flop", () => {
    const pre = { isRunout: true, bettingClosed: true } as const;
    expect(state({ ...pre, currentStreet: "preflop", persistedBoardCount: 0, revealDone: false })).toBe("runout_reveal");
    expect(state({ ...pre, currentStreet: "flop", persistedBoardCount: 0, revealDone: true })).toBe("enter_flop");
  });

  it("non-runout hand keeps the normal order (never enters runout_reveal)", () => {
    // turn board in, normal action street (not a runout)
    expect(state({ currentStreet: "turn", persistedBoardCount: 4, isRunout: false, bettingClosed: true })).toBe("turn_action");
    // river complete, normal showdown
    expect(state({ currentStreet: "river", persistedBoardCount: 5, isRunout: false, bettingClosed: false })).toBe("river_action");
  });

  it("uncalled all-in mid-street (bettingClosed=false) does NOT reveal — caller still owes", () => {
    expect(
      state({ currentStreet: "turn", persistedBoardCount: 4, isRunout: true, bettingClosed: false, revealDone: false }),
    ).toBe("turn_action");
  });

  it("river all-in (board already complete) skips the reveal and goes to showdown", () => {
    // persistedBoardCount === 5 → the `< 5` guard fails → no runout_reveal
    expect(
      state({ currentStreet: "showdown", persistedBoardCount: 5, isRunout: true, bettingClosed: true, revealDone: false }),
    ).toBe("showdown_input");
  });

  it("review/submit short-circuit always wins over runout_reveal", () => {
    expect(
      state({ isReview: true, reviewValid: false, currentStreet: "turn", persistedBoardCount: 3, isRunout: true, bettingClosed: true }),
    ).toBe("review_hand");
    expect(
      state({ isReview: true, reviewValid: true, currentStreet: "turn", persistedBoardCount: 3, isRunout: true, bettingClosed: true }),
    ).toBe("submit_ready");
  });

  it("old embedded tab (new inputs omitted) never enters runout_reveal", () => {
    // No isRunout / bettingClosed / revealDone — optional inputs default to no-runout.
    const legacy: TrackerWorkflowInput = {
      handStarted: true,
      blindsConfirmed: true,
      currentStreet: "turn" as WorkflowStreet,
      persistedBoardCount: 4,
      isReview: false,
      reviewValid: false,
      submitted: false,
    };
    expect(deriveTrackerWorkflowState(legacy)).toBe("turn_action");
  });
});
