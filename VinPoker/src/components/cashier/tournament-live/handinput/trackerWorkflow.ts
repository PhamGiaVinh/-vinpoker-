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
// All-in RUNOUT (P2-2): when an all-in + call closes betting before the river,
// the live procedure is reveal-first — players FLIP hole cards, THEN the dealer
// runs out the remaining board, THEN settle. So a `runout_reveal` state is
// inserted right when betting closes (once), BEFORE the remaining enter_* board
// streets:
//   …_action (all-in+call) → runout_reveal → enter_{remaining…} → showdown_input
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
  | "runout_reveal"
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
  /**
   * P2-2 all-in runout (OPTIONAL — only the engine standalone console passes these;
   * the old embedded tab omits them and keeps its reveal-at-showdown order):
   * `isRunout` ≤1 player can still act; `bettingClosed` the current round's betting
   * is complete; `revealDone` the operator has already flipped hole cards this hand.
   */
  isRunout?: boolean;
  bettingClosed?: boolean;
  revealDone?: boolean;
}

const REQUIRED_BOARD: Record<"flop" | "turn" | "river", number> = { flop: 3, turn: 4, river: 5 };

export function deriveTrackerWorkflowState(i: TrackerWorkflowInput): TrackerWorkflowState {
  if (!i.handStarted) return "setup_hand";
  if (i.submitted) return "hand_complete";
  // Review/submit short-circuit (fold-win also lands here with a prefilled winner).
  if (i.isReview) return i.reviewValid ? "submit_ready" : "review_hand";
  // All-in RUNOUT reveal-first (P2-2): once betting is closed with no further action
  // possible and board streets remain, reveal hole cards BEFORE running out the board.
  // `bettingClosed` is required (not just `isRunout`): mid-street an uncalled all-in
  // makes `isRunout` true while a caller still has a decision pending. Fires once
  // (until `revealDone`), then the remaining enter_* board streets proceed.
  if (i.isRunout && i.bettingClosed && i.persistedBoardCount < 5 && !i.revealDone) {
    return "runout_reveal";
  }
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

/** The all-in runout reveal-first step (reveal hole cards before running out the board). */
export function isRevealState(s: TrackerWorkflowState): boolean {
  return s === "runout_reveal";
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
