// tests/pokerEngine/illegalActions.test.ts
// Comprehensive rejection matrix. Legality rules themselves are covered in
// betting.test.ts; THIS suite proves the rejection side-effects contract:
// every rejected action returns the SAME state reference, emits ZERO events,
// and leaves the state byte-identical — plus the rejection cases the basic
// suite does not cover (after-complete, folded/all-in actors, missing/oversize
// amounts, lost reopen rights, empty legal menus).

import { describe, it, expect } from 'vitest';
import { applyAction, legalActions, makeDeck, shuffle, serializeForTransport } from '@engine/index.ts';
import type { Action, HandState } from '@engine/index.ts';
import { freshHand, play, mulberry32 } from './fixtures.ts';

/** Assert the action is rejected AND the engine's no-side-effects contract holds. */
function expectRejected(prev: HandState, action: Action, msgPart: string): void {
  const before = serializeForTransport(prev);
  const r = applyAction(prev, action);
  expect(r.error, `expected rejection for ${serializeForTransport(action)}`).toBeTruthy();
  expect(r.error).toContain(msgPart);
  expect(r.state).toBe(prev);                       // same reference returned
  expect(r.events).toEqual([]);                     // no events on rejection
  expect(serializeForTransport(prev)).toBe(before); // input not mutated
}

// 3-handed, button 1 => SB=2, BB=3, UTG=1 to act preflop.
const fresh3 = () =>
  freshHand([1000n, 1000n, 1000n], { button: 1, deck: shuffle(makeDeck(), mulberry32(17)) });

describe('turn & status rejections (state provably untouched)', () => {
  it('rejects an out-of-turn action and an unknown seat', () => {
    const st = fresh3();
    expectRejected(st, { type: 'fold', seat: 2 }, 'not your turn');
    expectRejected(st, { type: 'fold', seat: 99 }, 'not your turn');
  });

  it('rejects any action once the hand is complete', () => {
    const hu = freshHand([1000n, 1000n], { button: 1 });
    const done = applyAction(hu, { type: 'fold', seat: 1 }).state;
    expect(done.status).toBe('complete');
    expectRejected(done, { type: 'check', seat: 2 }, 'hand is not in a betting round');
    expectRejected(done, { type: 'allin', seat: 1 }, 'hand is not in a betting round');
  });

  it('rejects actions from folded and all-in seats (turn pointer skips them)', () => {
    const st = play(fresh3(), [
      { type: 'allin', seat: 1 },   // UTG shoves
      { type: 'fold', seat: 2 },    // SB folds
    ]).state;
    expect(st.toAct).toBe(3);
    expectRejected(st, { type: 'call', seat: 2 }, 'not your turn');  // folded seat
    expectRejected(st, { type: 'check', seat: 1 }, 'not your turn'); // all-in seat
  });
});

describe('action-type rejections', () => {
  it('rejects bet when a bet already stands (must raise) and call when nothing is owed', () => {
    const st = fresh3();
    expectRejected(st, { type: 'bet', seat: 1, amount: 300n }, 'action not legal: bet');

    // limped to the flop: currentBet 0, first to act is SB (seat 2)
    const flop = play(st, [
      { type: 'call', seat: 1 }, { type: 'call', seat: 2 }, { type: 'check', seat: 3 },
    ]).state;
    expect(flop.street).toBe('flop');
    expect(flop.toAct).toBe(2);
    expectRejected(flop, { type: 'call', seat: 2 }, 'action not legal: call');
  });
});

describe('amount rejections', () => {
  it('rejects bet/raise without an amount', () => {
    const st = fresh3();
    expectRejected(st, { type: 'raise', seat: 1 }, 'raise requires an amount');
    const flop = play(st, [
      { type: 'call', seat: 1 }, { type: 'call', seat: 2 }, { type: 'check', seat: 3 },
    ]).state;
    expectRejected(flop, { type: 'bet', seat: 2 }, 'bet requires an amount');
  });

  it('rejects zero, negative, and over-stack sizes', () => {
    const flop = play(fresh3(), [
      { type: 'call', seat: 1 }, { type: 'call', seat: 2 }, { type: 'check', seat: 3 },
    ]).state;
    expectRejected(flop, { type: 'bet', seat: 2, amount: 0n }, 'illegal bet size');
    expectRejected(flop, { type: 'bet', seat: 2, amount: -5n }, 'illegal bet size');
    expectRejected(flop, { type: 'bet', seat: 2, amount: 2000n }, 'illegal bet size'); // stack is 900
    const st = fresh3();
    expectRejected(st, { type: 'raise', seat: 1, amount: 5000n }, 'illegal raise size');
  });
});

describe('no-reopen rule rejections', () => {
  // UTG raises to 200; SB folds; short-stacked BB shoves 230 total (incr 30 < 100
  // = not a full raise) => UTG must respond but may NOT raise or shove again.
  const noReopen = () =>
    play(freshHand([1000n, 1000n, 230n], { button: 1, deck: shuffle(makeDeck(), mulberry32(17)) }), [
      { type: 'raise', seat: 1, amount: 200n },
      { type: 'fold', seat: 2 },
      { type: 'allin', seat: 3 },
    ]).state;

  it('an already-acted seat facing a short all-in may only fold or call', () => {
    const st = noReopen();
    expect(st.toAct).toBe(1);
    expect(legalActions(st, 1).types).toEqual(['fold', 'call']);
    expectRejected(st, { type: 'raise', seat: 1, amount: 600n }, 'action not legal: raise');
    expectRejected(st, { type: 'allin', seat: 1 }, 'action not legal: allin');
  });
});

describe('legalActions empty menus', () => {
  it('returns an empty menu for non-actors, folded seats, unknown seats, and complete hands', () => {
    const st = fresh3();
    expect(legalActions(st, 2).types).toEqual([]);   // not their turn
    expect(legalActions(st, 99).types).toEqual([]);  // unknown seat

    const afterFold = applyAction(st, { type: 'fold', seat: 1 }).state;
    expect(legalActions(afterFold, 1).types).toEqual([]); // folded

    const hu = freshHand([1000n, 1000n], { button: 1 });
    const done = applyAction(hu, { type: 'fold', seat: 1 }).state;
    for (const seat of [1, 2]) expect(legalActions(done, seat).types).toEqual([]); // complete
  });
});
