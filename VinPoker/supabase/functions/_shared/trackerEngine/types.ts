// Tracker server-side validation engine — shared types.
//
// This engine is the SERVER's authority for the Tournament Live Tracker. It
// reconstructs hand state from what the DB already stores (hand_players seeds +
// the hand_actions stream + tournament_hands.button_seat) and validates a
// proposed operator action against the rules of No-Limit Hold'em. It also
// recomputes side pots so the server never trusts client-supplied side_pots.
//
// It is NOT the GE-2 online runtime: no deck, no shuffle, no wallet, no
// op_*/online_poker_* coupling. Pure functions over plain numbers.

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export type TrackerActionType =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all_in"
  | "post_sb"
  | "post_bb"
  | "post_ante";

export const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown"];

/** Voluntary/posting actions that move chips into the pot. */
export const CONTRIBUTING_ACTIONS: TrackerActionType[] = [
  "call",
  "bet",
  "raise",
  "all_in",
  "post_sb",
  "post_bb",
  "post_ante",
];

/** Blind/ante posts — they seed the pot but are not "voluntary" betting actions. */
export const POSTING_ACTIONS: TrackerActionType[] = ["post_sb", "post_bb", "post_ante"];

/** Per-player seed as start_hand wrote it into hand_players. */
export interface PlayerSeed {
  player_id: string;
  seat_number: number;
  starting_stack: number;
}

/** One row from the hand_actions stream (server-trusted, already persisted). */
export interface ActionRow {
  player_id: string;
  street: Street;
  action_type: TrackerActionType;
  action_amount: number;
  action_order: number;
}

/** A proposed action the operator is trying to record (not yet trusted). */
export interface ProposedAction {
  player_id: string;
  street: Street;
  action_type: TrackerActionType;
  action_amount: number;
  action_order: number;
}

/** Reconstructed runtime state for one player after replaying the action stream. */
export interface PlayerRuntime {
  player_id: string;
  seat_number: number;
  starting_stack: number;
  /** Chips still behind. */
  stack: number;
  /** Chips committed on the CURRENT street. */
  street_bet: number;
  /** Chips committed across ALL streets (drives pot/side-pot math). */
  total_bet: number;
  is_folded: boolean;
  is_all_in: boolean;
  /** Has voluntarily acted (not just posted a blind) on the current street. */
  has_acted_this_street: boolean;
}

/** Reconstructed hand-level runtime. */
export interface HandRuntime {
  players: PlayerRuntime[];
  buttonSeat: number;
  street: Street;
  /** Highest street_bet anyone has committed this street. */
  highestBet: number;
  /** Minimum legal raise INCREMENT for the next raise this street. */
  minRaise: number;
  /** Number of voluntary bets/raises seen this street (re-open tracking). */
  aggressionCount: number;
  /** Big blind as posted this hand (0 if no post_bb seen). Anchors min bet/raise. */
  bigBlind: number;
}

export type ValidationCode =
  | "OK"
  | "HAND_NOT_ACTIVE"
  | "PLAYER_NOT_IN_HAND"
  | "PLAYER_FOLDED"
  | "PLAYER_ALL_IN"
  | "OUT_OF_TURN"
  | "ILLEGAL_ACTION_TYPE"
  | "CHECK_FACING_BET"
  | "CALL_WITH_NOTHING_TO_CALL"
  | "BET_WHEN_FACING_BET"
  | "RAISE_WITHOUT_BET"
  | "AMOUNT_EXCEEDS_STACK"
  | "BELOW_MIN_RAISE"
  | "NON_POSITIVE_AMOUNT"
  | "STREET_ACTION_PENDING"
  | "SIDE_POTS_TAMPERED";

export interface ValidationResult {
  valid: boolean;
  code: ValidationCode;
  /** Human-facing message (Vietnamese — surfaced as the operator toast). */
  message: string;
  /**
   * The amount the server would actually record for this action after clamping
   * to stack / call size. The operator UI computes this too, but the server
   * value is authoritative.
   */
  normalizedAmount: number;
}

export type ValidationMode = "enforce" | "warn";
