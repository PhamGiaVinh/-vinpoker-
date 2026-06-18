// Tracker Operator Workflow v2 — the single source of truth for the engine-mode
// Hand Input. In engine mode the operator may only do the ONE valid step for the
// current state; the UI renders one sub-panel and the handlers HARD-GATE on this
// state (defense-in-depth — not just hiding buttons). Supersedes enginePhase.ts.
//
// Sequence:
//   setup_hand → setup_blinds → preflop_action
//   → enter_flop → flop_action → enter_turn → turn_action
//   → enter_river → river_action → showdown_input → review_hand
//   → submit_ready → hand_complete
//
// "board persisted" is derived from the PERSISTED board count
// (community_cards.length: ≥3 flop, ≥4 turn, ≥5 river) — NOT local entry state,
// so a refresh can't make the gate forget a sent board.

export type WorkflowStreet = "preflop" | "flop" | "turn" | "river" | "showdown";

export type TrackerWorkflowState =
  | "setup_hand"
  | "setup_blinds"
  | "preflop_action"
  | "enter_flop"
  | "flop_action"
  | "enter_turn"
  | "turn_action"
  | "enter_river"
  | "river_action"
  | "showdown_input"
  | "review_hand"
  | "submit_ready"
  | "hand_complete";

export interface TrackerWorkflowInput {
  handStarted: boolean;
  blindsConfirmed: boolean;
  currentStreet: WorkflowStreet;
  /** Persisted community-card count (from tournament_hands.community_cards). */
  persistedBoardCount: number;
  /** Review screen open (operator-entered/derived ending stacks present). */
  isReview: boolean;
  /** Review is submittable: chips conserved AND a winner/result is determined. */
  reviewValid: boolean;
  /** record_hand succeeded for this hand. */
  submitted: boolean;
}

const REQUIRED_BOARD: Record<"flop" | "turn" | "river", number> = { flop: 3, turn: 4, river: 5 };

export function deriveTrackerWorkflowState(i: TrackerWorkflowInput): TrackerWorkflowState {
  if (!i.handStarted) return "setup_hand";
  if (i.submitted) return "hand_complete";
  // Review/submit short-circuit (fold-win also lands here with a prefilled winner).
  if (i.isReview) return i.reviewValid ? "submit_ready" : "review_hand";
  if (i.currentStreet === "preflop") return i.blindsConfirmed ? "preflop_action" : "setup_blinds";
  if (i.currentStreet === "showdown") return "showdown_input";
  // flop / turn / river: action only after the board is PERSISTED.
  const need = REQUIRED_BOARD[i.currentStreet];
  return i.persistedBoardCount >= need
    ? (`${i.currentStreet}_action` as TrackerWorkflowState)
    : (`enter_${i.currentStreet}` as TrackerWorkflowState);
}

/** States in which a player betting action (handAction) is legal. */
export function isActionState(s: TrackerWorkflowState): boolean {
  return s === "preflop_action" || s === "flop_action" || s === "turn_action" || s === "river_action";
}

/** States in which the operator enters + sends a board street. */
export function isBoardEntryState(s: TrackerWorkflowState): boolean {
  return s === "enter_flop" || s === "enter_turn" || s === "enter_river";
}

/** The street whose board is being entered (else null). */
export function boardEntryStreet(s: TrackerWorkflowState): "flop" | "turn" | "river" | null {
  if (s === "enter_flop") return "flop";
  if (s === "enter_turn") return "turn";
  if (s === "enter_river") return "river";
  return null;
}

/** The street an action belongs to (for the action hard-gate). */
export function actionState(street: WorkflowStreet): TrackerWorkflowState | null {
  if (street === "preflop") return "preflop_action";
  if (street === "flop") return "flop_action";
  if (street === "turn") return "turn_action";
  if (street === "river") return "river_action";
  return null;
}

export const REQUIRED_BOARD_COUNT = REQUIRED_BOARD;
