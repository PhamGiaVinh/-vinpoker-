// supabase/functions/_shared/pokerEngine/replay.ts
//
// Deterministic hand replay. Because the engine is a pure reducer with an
// INJECTED deck, a hand is fully determined by (config, deck, seat inputs,
// action sequence). Replaying that script MUST reproduce the exact same final
// state and event stream — this is the audit/dispute/forensics primitive and
// the determinism guarantee GE-5 replay tooling will build on.
//
// NOTE: public hand events alone are NOT a replay source — `action` events
// carry the chip DELTA, while engine `Action.amount` for bet/raise is the
// TOTAL "raise to" target. The persistence layer therefore stores the original
// validated actions (online_poker_actions.action) and replays from those.

import type { Action, ApplyResult, Card, HandConfig, HandEvent, HandState, SeatInput } from './types.ts';
import { applyAction, createHand } from './hand.ts';
import { assertInvariants } from './invariants.ts';

/** Everything needed to reproduce a hand bit-for-bit. */
export interface HandScript {
  config: Omit<HandConfig, 'schemaVersion'> & { schemaVersion?: number };
  /** The full shuffled deck as dealt (from hand secrets / forensic store). */
  deck: Card[];
  seats: SeatInput[];
  /** The validated actions in applied order (NOT derived from public events). */
  actions: Action[];
}

/** Replay failed: the stored script does not replay cleanly — treat as corrupt. */
export class ReplayError extends Error {
  constructor(
    /** Index into HandScript.actions of the action that was rejected. */
    readonly actionIndex: number,
    readonly reason: string,
  ) {
    super(`replay rejected action[${actionIndex}]: ${reason}`);
    this.name = 'ReplayError';
  }
}

/**
 * Re-run a hand from its script. Throws ReplayError if any stored action is
 * rejected (an authoritative log must replay cleanly — a rejection means the
 * log or the engine version is wrong). Invariants are asserted after every
 * step (this is the offline audit path; the cost is acceptable there).
 */
export function replayHand(script: HandScript): ApplyResult {
  const initialTotal = script.seats.reduce((a, s) => a + s.stack, 0n);

  const created = createHand(script.config, script.deck, script.seats);
  let state: HandState = created.state;
  const events: HandEvent[] = [...created.events];
  assertInvariants(state, initialTotal);

  for (const [i, action] of script.actions.entries()) {
    const r = applyAction(state, action);
    if (r.error) throw new ReplayError(i, r.error);
    state = r.state;
    events.push(...r.events);
    assertInvariants(state, initialTotal);
  }

  return { state, events };
}
