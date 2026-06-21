// supabase/functions/_shared/pokerEngine/index.ts
// Public API barrel for the VinPoker pure NLH rules engine.
// Imported by Deno (Edge), the future actor server, and Vitest (via @engine) —
// NEVER by the client Vite build (no @engine alias there = build-level guardrail).

export * from './types.ts';
export { RANKS, SUITS, CARD_RE, RANK_VALUE, SUIT_INDEX, isCard, parseCard, makeDeck, assertNoDuplicates } from './deck.ts';
export { createHand, applyAction, forcedTimeoutAction, cloneState, SCHEMA_VERSION } from './hand.ts';
export {
  legalActions, validateAction, nextPlayerToAct, isBettingRoundComplete,
  seatsInClockwiseOrder, firstClockwiseFrom, nextActorAfter,
} from './betting.ts';
export { computeSidePots, refundUncalled, clockwiseSeatOrder, distribute } from './pots.ts';
export { nextButtonTournament } from './button.ts';
export type { DeadButtonInput } from './button.ts';
export { evaluate5, evaluateBest, compareHands, compareRankVec, HAND_CATEGORY_NAME } from './evaluate.ts';
export type { EvaluatedHand, HandCategoryName } from './evaluate.ts';
export { evaluateShowdown } from './showdown.ts';
export { toPublicView, toPrivateView, serializeForTransport } from './views.ts';
export type { PublicHandState, PrivateHandState, PublicSeat } from './views.ts';
export { cryptoRng32, unbiasedIndex, shuffle, shuffledDeck } from './shuffle.ts';
export type { Rng32 } from './shuffle.ts';
export {
  chipToString, parseChip, actionFromRequest, classifyActionError,
  envelopeEvents, toWirePublicState, toWirePrivateState, toWireLegalActions,
} from './contracts.ts';
export type {
  ChipString, ActionRequest, ActionRejectedCode, ActionAccepted, ActionRejected,
  ActionResult, GameEventEnvelope, WireHandConfig, WireSidePot, WirePotAward,
  WireHandResult, WirePublicSeat, WirePublicHandState, WirePrivateHandState,
  WireLegalActions,
} from './contracts.ts';
export { checkInvariants, assertInvariants } from './invariants.ts';
export { replayHand, ReplayError } from './replay.ts';
export type { HandScript } from './replay.ts';
// provableFair.* is intentionally NOT re-exported here — it is optional Phase-3
// crypto, imported directly where needed, and never on the Phase-1 deal path.
