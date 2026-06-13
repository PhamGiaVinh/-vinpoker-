// tests/pokerAdapter/serialize.test.ts
// GE-2C adapter: lossless authoritative (de)serialization, deserialize->applyAction
// equivalence, original-deck replay cross-check, and strict chip canonicalization.

import { describe, it, expect } from 'vitest';
import {
  createHand, applyAction, legalActions, makeDeck, replayHand,
} from '@engine/index.ts';
import type { Action, HandState, LegalActions, SeatInput } from '@engine/index.ts';
import {
  serializeAuthoritative, deserializeAuthoritative,
} from '../../supabase/functions/_shared/pokerAdapter/index.ts';
import { freshHand, si } from '../pokerEngine/fixtures.ts';

/** Pick a chip-conserving legal action: check > call > fold. */
function pick(la: LegalActions, seat: number): Action {
  if (la.canCheck) return { type: 'check', seat };
  if (la.types.includes('call')) return { type: 'call', seat };
  return { type: 'fold', seat };
}

/** Apply up to `max` legal actions, recording them. */
function drive(start: HandState, max: number): { state: HandState; actions: Action[] } {
  let st = start;
  const actions: Action[] = [];
  for (let i = 0; i < max && st.status === 'betting' && st.toAct != null; i++) {
    const a = pick(legalActions(st, st.toAct), st.toAct);
    const r = applyAction(st, a);
    if (r.error) break;
    st = r.state;
    actions.push(a);
  }
  return { state: st, actions };
}

/** Simulate jsonb storage: object -> JSON text -> object. */
const through = <T>(o: T): T => JSON.parse(JSON.stringify(o));

describe('serializeAuthoritative / deserializeAuthoritative', () => {
  it('round-trips a mid-hand state losslessly (identity through jsonb)', () => {
    const base = freshHand([1000n, 1000n, 1000n], { button: 1, sb: 25n, bb: 50n });
    const { state } = drive(base, 2); // advance into the hand
    const split = serializeAuthoritative(state);
    const restored = deserializeAuthoritative(through(split.stateJson), split.liveDeck, split.holes);
    expect(restored).toEqual(state);
  });

  it('round-trips holes + live deck into the secret store and back', () => {
    const state = freshHand([1000n, 1000n, 1000n], { button: 1 });
    const split = serializeAuthoritative(state);
    expect(split.holes).toHaveLength(3);
    expect(split.holes.every((h) => h.cards.length === 2)).toBe(true);
    expect(split.liveDeck.length).toBeGreaterThan(0);
    const restored = deserializeAuthoritative(through(split.stateJson), split.liveDeck, split.holes);
    for (const s of restored.seats) {
      const orig = state.seats.find((x) => x.seat === s.seat)!;
      expect(s.holeCards).toEqual(orig.holeCards);
    }
    expect(restored.deck).toEqual(state.deck);
  });

  it('deserialize-then-applyAction matches applyAction on the live state', () => {
    const base = freshHand([1000n, 1000n, 1000n], { button: 1, sb: 25n, bb: 50n });
    const { state } = drive(base, 1);
    const split = serializeAuthoritative(state);
    const restored = deserializeAuthoritative(through(split.stateJson), split.liveDeck, split.holes);

    const seat = state.toAct!;
    const action = pick(legalActions(state, seat), seat);
    const live = applyAction(state, action);
    const fromRestored = applyAction(restored, action);
    expect(fromRestored.state).toEqual(live.state);
    expect(fromRestored.events).toEqual(live.events);
  });

  it('original-deck replay reproduces the live-played state (audit cross-check)', () => {
    const deck = makeDeck();
    const seats: SeatInput[] = si([1000n, 1000n, 1000n]);
    const config = { handId: 'h1', tableId: 't1', handNo: 1, buttonSeat: 1, sb: 25n, bb: 50n };
    const created = createHand(config, deck, seats);
    const { state: played, actions } = drive(created.state, 4);

    const replayed = replayHand({ config, deck, seats, actions });
    expect(replayed.state).toEqual(played);
  });

  it('rejects a tampered/non-canonical chip field (fail-closed)', () => {
    const split = serializeAuthoritative(freshHand([1000n, 1000n], { button: 1 }));
    for (const badPot of ['-1', '1.5', '007', '', '1e3']) {
      const bad = through(split.stateJson);
      (bad as { pot: string }).pot = badPot;
      expect(() => deserializeAuthoritative(bad, split.liveDeck, split.holes)).toThrow();
    }
  });
});
