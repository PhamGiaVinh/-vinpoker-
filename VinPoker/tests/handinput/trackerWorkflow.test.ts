import { describe, it, expect } from "vitest";
import {
  deriveTrackerWorkflowState,
  isActionState,
  isBoardEntryState,
  boardEntryStreet,
  actionState,
  type TrackerWorkflowInput,
} from "@/components/cashier/tournament-live/handinput/trackerWorkflow";

const base: TrackerWorkflowInput = {
  handStarted: true,
  blindsConfirmed: true,
  currentStreet: "preflop",
  persistedBoardCount: 0,
  isReview: false,
  reviewValid: false,
  submitted: false,
};

describe("deriveTrackerWorkflowState — strict sequence", () => {
  it("setup_hand before start; setup_blinds before blinds; then preflop_action", () => {
    expect(deriveTrackerWorkflowState({ ...base, handStarted: false })).toBe("setup_hand");
    expect(deriveTrackerWorkflowState({ ...base, blindsConfirmed: false })).toBe("setup_blinds");
    expect(deriveTrackerWorkflowState(base)).toBe("preflop_action");
  });

  it("a postflop ACTION state is reached ONLY after the board is persisted", () => {
    // currentStreet auto-advances to flop after preflop closes, but with <3 cards
    // persisted the state is enter_flop (NOT flop_action).
    expect(deriveTrackerWorkflowState({ ...base, currentStreet: "flop", persistedBoardCount: 0 })).toBe("enter_flop");
    expect(deriveTrackerWorkflowState({ ...base, currentStreet: "flop", persistedBoardCount: 2 })).toBe("enter_flop");
    expect(deriveTrackerWorkflowState({ ...base, currentStreet: "flop", persistedBoardCount: 3 })).toBe("flop_action");
  });

  it("turn + river gates require their persisted card before action", () => {
    expect(deriveTrackerWorkflowState({ ...base, currentStreet: "turn", persistedBoardCount: 3 })).toBe("enter_turn");
    expect(deriveTrackerWorkflowState({ ...base, currentStreet: "turn", persistedBoardCount: 4 })).toBe("turn_action");
    expect(deriveTrackerWorkflowState({ ...base, currentStreet: "river", persistedBoardCount: 4 })).toBe("enter_river");
    expect(deriveTrackerWorkflowState({ ...base, currentStreet: "river", persistedBoardCount: 5 })).toBe("river_action");
  });

  it("river → showdown → review → submit", () => {
    expect(deriveTrackerWorkflowState({ ...base, currentStreet: "showdown", persistedBoardCount: 5 })).toBe("showdown_input");
    expect(deriveTrackerWorkflowState({ ...base, isReview: true, reviewValid: false })).toBe("review_hand");
    expect(deriveTrackerWorkflowState({ ...base, isReview: true, reviewValid: true })).toBe("submit_ready");
    expect(deriveTrackerWorkflowState({ ...base, submitted: true })).toBe("hand_complete");
  });
});

describe("no-bypass guarantees (the hard-gate predicates)", () => {
  it("board-entry / showdown / review states are NOT action states (action blocked there)", () => {
    for (const s of ["enter_flop", "enter_turn", "enter_river", "showdown_input", "review_hand", "submit_ready", "setup_blinds"] as const) {
      expect(isActionState(s)).toBe(false);
    }
    for (const s of ["preflop_action", "flop_action", "turn_action", "river_action"] as const) {
      expect(isActionState(s)).toBe(true);
    }
  });
  it("only enter_* are board-entry states; boardEntryStreet maps them", () => {
    expect(isBoardEntryState("enter_flop")).toBe(true);
    expect(isBoardEntryState("flop_action")).toBe(false);
    expect(boardEntryStreet("enter_turn")).toBe("turn");
    expect(boardEntryStreet("turn_action")).toBeNull();
  });
  it("actionState maps a street to its action state", () => {
    expect(actionState("preflop")).toBe("preflop_action");
    expect(actionState("river")).toBe("river_action");
    expect(actionState("showdown")).toBeNull();
  });
});
