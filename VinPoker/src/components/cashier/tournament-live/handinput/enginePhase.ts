// Pure UI-phase model for Tracker Engine Mode (Street Gate / Board Entry).
//
// The operator flow is strictly sequential:
//   button_setup → blind_setup → action_preflop
//   → enter_flop → action_flop → enter_turn → action_turn
//   → enter_river → action_river → showdown
//
// Crucially, an `action_*` phase for a postflop street is ONLY reached once that
// street's board cards are PERSISTED (`boardSent` — i.e. update_community_cards
// succeeded and the street is in sentCommunityStreets). While the board is not
// yet sent the phase is `enter_*` and the ActionDock stays hidden, so the next
// street's action can't begin before its cards are saved. `currentStreet` may
// auto-advance after a round closes (that's what makes the card slots active),
// but the gate keeps action blocked until the board persists.

export type PhaseStreet = "preflop" | "flop" | "turn" | "river" | "showdown";

export type EnginePhase =
  | "button_setup"
  | "blind_setup"
  | "action_preflop"
  | "enter_flop"
  | "action_flop"
  | "enter_turn"
  | "action_turn"
  | "enter_river"
  | "action_river"
  | "showdown";

export interface EnginePhaseInput {
  handStarted: boolean;
  blindsConfirmed: boolean;
  currentStreet: PhaseStreet;
  /** True once THIS street's board cards are persisted (sentCommunityStreets). */
  boardSent: boolean;
  /** Review/settlement screen is open. */
  isSummary: boolean;
}

export function deriveEnginePhase(i: EnginePhaseInput): EnginePhase {
  if (!i.handStarted) return "button_setup";
  if (i.isSummary) return "showdown";
  if (i.currentStreet === "preflop") return i.blindsConfirmed ? "action_preflop" : "blind_setup";
  if (i.currentStreet === "showdown") return "showdown";
  // flop / turn / river: action only after the board is persisted.
  return i.boardSent
    ? (`action_${i.currentStreet}` as EnginePhase)
    : (`enter_${i.currentStreet}` as EnginePhase);
}

export function isActionPhase(p: EnginePhase): boolean {
  return p === "action_preflop" || p === "action_flop" || p === "action_turn" || p === "action_river";
}

export function isBoardEntryPhase(p: EnginePhase): boolean {
  return p === "enter_flop" || p === "enter_turn" || p === "enter_river";
}

/** The street whose board must be entered for an `enter_*` phase (else null). */
export function boardEntryStreet(p: EnginePhase): "flop" | "turn" | "river" | null {
  if (p === "enter_flop") return "flop";
  if (p === "enter_turn") return "turn";
  if (p === "enter_river") return "river";
  return null;
}
