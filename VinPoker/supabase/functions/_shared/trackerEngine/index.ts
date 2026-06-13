// Tracker server-side validation engine — public surface.
//
// Server-authoritative rules layer for the Tournament Live Tracker. Reconstructs
// hand state from hand_players + hand_actions, validates proposed operator
// actions, and recomputes side pots so client-supplied side_pots are never
// trusted. NOT the GE-2 online runtime — no deck/shuffle/wallet/op_* coupling.

export * from "./types.ts";
export {
  reduceHand,
  nextToAct,
  isBettingRoundComplete,
  findPlayer,
} from "./handState.ts";
export {
  validateAction,
  reconcileSidePots,
  type SidePotReconciliation,
} from "./validateAction.ts";
export {
  computePotBreakdown,
  contributionsFromActions,
  toSidePotsJson,
  type PotBreakdown,
  type PotLayer,
  type PotContributor,
} from "./potEngine.ts";
