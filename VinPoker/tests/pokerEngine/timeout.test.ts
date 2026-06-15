// tests/pokerEngine/timeout.test.ts
// PR C — timeout-sweep hardening (engine half). An AFK / disconnected player must
// not stall a table: the engine's forcedTimeoutAction picks check-if-free-else-fold,
// and applying it always advances the hand. These are pure-engine tests (no DB/Edge);
// the server WIRING (sweep edge fn + pg_cron) is authored source-only in
// supabase/functions/online-poker-timeout-sweep + the cron migration — NOT applied here.
//
// Source-only; online poker stays dark.

import { describe, it, expect } from 'vitest';
import { applyAction, forcedTimeoutAction, legalActions, makeDeck, shuffle } from '@engine/index.ts';
import type { HandState } from '@engine/index.ts';
import { freshHand, mulberry32, totalChips } from './fixtures.ts';

const deal9 = (seed: number): HandState =>
  freshHand(Array.from({ length: 9 }, () => 5000n), { deck: shuffle(makeDeck(), mulberry32(seed)) });

/** Drive the to-act seat with forcedTimeoutAction until the hand is no longer betting. */
function forceToCompletion(state: HandState, cap = 600): { state: HandState; steps: number } {
  let st = state, n = 0;
  while (st.status === 'betting' && st.toAct != null) {
    const a = forcedTimeoutAction(st, st.toAct);
    const r = applyAction(st, a);
    if (r.error) throw new Error(`forced ${a.type}@${st.toAct} rejected: ${r.error}`);
    st = r.state; n++;
    if (n > cap) throw new Error('forced timeouts did not terminate (stuck hand)');
  }
  return { state: st, steps: n };
}

/** Passive drive (check>call) until the given street is reached. */
function driveToStreet(state: HandState, street: HandState['street'], cap = 200): HandState {
  let st = state, n = 0;
  while (st.status === 'betting' && st.street !== street && st.toAct != null) {
    const la = legalActions(st, st.toAct);
    const t = la.canCheck ? 'check' : 'call';
    const r = applyAction(st, { type: t, seat: st.toAct });
    if (r.error) throw new Error(`drive ${t} rejected: ${r.error}`);
    st = r.state;
    if (++n > cap) throw new Error('driveToStreet did not reach street');
  }
  return st;
}

describe('forced timeout (PR C engine half)', () => {
  it('facing a bet → forced FOLD (a legal, accepted action)', () => {
    const st = deal9(1);                          // preflop, UTG faces the BB
    const seat = st.toAct!;
    const la = legalActions(st, seat);
    expect(la.toCall > 0n).toBe(true);            // genuinely facing a bet
    const a = forcedTimeoutAction(st, seat);
    expect(a).toEqual({ type: 'fold', seat });
    const r = applyAction(st, a);
    expect(r.error).toBeUndefined();
    expect(r.state.seats.find((s) => s.seat === seat)!.status).toBe('folded');
  });

  it('nothing to call → forced CHECK (a legal, accepted action)', () => {
    const flop = driveToStreet(deal9(2), 'flop');  // postflop: currentBet resets to 0
    expect(flop.status).toBe('betting');
    const seat = flop.toAct!;
    expect(legalActions(flop, seat).canCheck).toBe(true);
    const a = forcedTimeoutAction(flop, seat);
    expect(a).toEqual({ type: 'check', seat });
    expect(applyAction(flop, a).error).toBeUndefined();
  });

  it('the seat to act is always ACTIVE — an all-in seat is never the timeout target', () => {
    // drive an all-in-heavy line; at every betting step the to-act seat must be active,
    // so forcedTimeoutAction can never fold/check on behalf of an all-in (or folded) seat.
    let st = freshHand([300n, 550n, 800n, 1100n, 1500n, 2000n, 2600n, 3300n, 4200n],
      { deck: shuffle(makeDeck(), mulberry32(3)) });
    const rng = mulberry32(33);
    let guard = 0;
    while (st.status === 'betting' && st.toAct != null) {
      const seat = st.toAct;
      expect(st.seats.find((s) => s.seat === seat)!.status).toBe('active'); // never all-in/folded
      const la = legalActions(st, seat);
      const type = la.types.includes('allin') && rng() % 2 === 0 ? 'allin' : (la.canCheck ? 'check' : 'call');
      const r = applyAction(st, { type, seat });
      if (r.error) break;
      st = r.state;
      if (++guard > 800) break;
    }
  });

  it('forced timeouts always RESOLVE the hand (no stuck table), chips conserved', () => {
    for (const seed of [10, 11, 12, 13, 14]) {
      const st0 = deal9(seed);
      const total = totalChips(st0);
      const { state, steps } = forceToCompletion(st0);     // simulate the whole table AFK
      expect(state.status).toBe('complete');               // never stuck
      expect(steps).toBeLessThanOrEqual(60);               // resolves promptly
      expect(totalChips(state)).toBe(total);               // conserved
    }
  });

  it('also resolves a postflop check-down via forced timeouts', () => {
    const flop = driveToStreet(deal9(20), 'flop');
    const total = totalChips(flop);
    const { state } = forceToCompletion(flop);
    expect(state.status).toBe('complete');
    expect(totalChips(state)).toBe(total);
  });

  it('forcedTimeoutAction is deterministic + applyAction is pure (idempotent at engine level)', () => {
    const st = deal9(7);
    const seat = st.toAct!;
    const a1 = forcedTimeoutAction(st, seat);
    const a2 = forcedTimeoutAction(st, seat);
    expect(a1).toEqual(a2);                                // deterministic choice
    const before = JSON.stringify(st.seats.map((s) => [s.seat, s.stack.toString(), s.status]));
    const r1 = applyAction(st, a1);
    const r2 = applyAction(st, a1);
    expect(JSON.stringify(st.seats.map((s) => [s.seat, s.stack.toString(), s.status]))).toBe(before); // input unmutated
    expect(r1.state.toAct).toBe(r2.state.toAct);           // same outcome both times
    expect(r1.state.seats.find((s) => s.seat === seat)!.status)
      .toBe(r2.state.seats.find((s) => s.seat === seat)!.status);
    // NOTE: durable replay-idempotency (same idempotency_key → stored response, no double
    // action) is the RPC layer (op_submit_action) — exercised by the sweep at Phase D.
  });
});
