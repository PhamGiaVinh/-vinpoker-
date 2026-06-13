// supabase/functions/_shared/pokerAdapter/index.ts
//
// GE-2C engine adapter — the thin, pure bridge between the persisted online_poker_*
// schema and the pure pokerEngine. The Edge function (online-poker-action) is the
// ONLY runtime that executes engine TS; this adapter is how it (de)serializes
// authoritative state and maps DB rows <-> engine inputs/outputs. It NEVER
// re-implements poker rules or secrecy — those stay in pokerEngine.
//
// Imported by Deno (Edge) via relative paths; NEVER by the client Vite build.

export { serializeAuthoritative, deserializeAuthoritative } from './serialize.ts';
export type { AuthoritativeSplit, SeatHole } from './serialize.ts';

export {
  ENGINE_VERSION, buildSeatInputs, buildHandConfig,
  actionToRow, actionFromRow, eventRows,
} from './dbMap.ts';
export type { SeatRow, TableRow, HandEventRow } from './dbMap.ts';

// Single adapter surface for the Edge layer's public/private projections so it
// never re-implements the secrecy boundary (these ARE the engine's own views).
export { toWirePublicState as publicProjection, toWirePrivateState as privateView } from '../pokerEngine/index.ts';
