import { describe, it, expect } from "vitest";
import {
  isActionState,
  isBoardEntryState,
  type TrackerWorkflowState,
} from "@/components/cashier/tournament-live/handinput/trackerWorkflow";

// Mirrors the bottom-panel switch in HandInputPanel (engine branch): every
// workflow state maps to EXACTLY ONE guided panel. This is the invariant that
// keeps "1 bước, 1 nhiệm vụ" true — no state may show two panels or none.
type PanelKind = "setup" | "blinds" | "action" | "board" | "showdown" | "review" | "complete";

function panelKind(s: TrackerWorkflowState): PanelKind {
  if (s === "setup_hand") return "setup";
  if (s === "setup_blinds") return "blinds";
  if (isActionState(s)) return "action";
  if (isBoardEntryState(s)) return "board";
  if (s === "showdown_input") return "showdown";
  if (s === "review_hand" || s === "submit_ready") return "review";
  return "complete"; // hand_complete
}

const EXPECTED: Record<TrackerWorkflowState, PanelKind> = {
  setup_hand: "setup",
  setup_blinds: "blinds",
  preflop_action: "action",
  enter_flop: "board",
  flop_action: "action",
  enter_turn: "board",
  turn_action: "action",
  enter_river: "board",
  river_action: "action",
  showdown_input: "showdown",
  review_hand: "review",
  submit_ready: "review",
  hand_complete: "complete",
};

const ALL_STATES = Object.keys(EXPECTED) as TrackerWorkflowState[];

describe("workflow → panel mapping (one panel per state)", () => {
  it("maps each of the 13 states to its expected single panel kind", () => {
    for (const s of ALL_STATES) {
      expect(panelKind(s)).toBe(EXPECTED[s]);
    }
  });

  it("covers all seven panel kinds (no kind is unreachable)", () => {
    const kinds = new Set(ALL_STATES.map(panelKind));
    expect([...kinds].sort()).toEqual(
      ["action", "blinds", "board", "complete", "review", "setup", "showdown"]
    );
  });

  it("action and board-entry states are mutually exclusive", () => {
    for (const s of ALL_STATES) {
      expect(isActionState(s) && isBoardEntryState(s)).toBe(false);
    }
  });
});
