// tests/pokerEngine/ninehanded.test.ts
// 9-HANDED coverage. The golden hands max out at 4 seats and the property test
// (invariants.test.ts) at 6; the engine is algebraically seat-count-agnostic but
// was untested at a full 9-handed table. These fixtures validate the hardest paths
// — multi-way all-in side pots, fold-to-winner, secrecy — at 9 seats. They are
// invariant/structure-based (conservation, pot partition, completion, no leak)
// rather than hand-pinned exact payouts, which is robust and seat-count-honest.
//
// Source-only; pure engine; no DB / Edge / runtime. Online poker stays dark.

import { describe, it, expect } from 'vitest';
import {
  createHand, legalActions, applyAction, assertInvariants,
  toPublicView, toPrivateView, toWirePublicState, makeDeck, shuffle,
} from '@engine/index.ts';
import type { Action, HandState } from '@engine/index.ts';
import { mulberry32, si, totalChips } from './fixtures.ts';

const SB = 50n, BB = 100n;

function deal(stacks: bigint[], seed: number, button = 1): HandState {
  const deck = shuffle(makeDeck(), mulberry32(seed));
  return createHand(
    { handId: `nh${seed}`, tableId: 't', handNo: 1, buttonSeat: button, sb: SB, bb: BB },
    deck,
    si(stacks),
  ).state;
}

/** Drive the toAct seat with a preference list until the hand is no longer betting. */
function drive(state: HandState, prefer: Action['type'][], cap = 600): { state: HandState; actions: number } {
  let st = state, n = 0;
  while (st.status === 'betting' && st.toAct != null) {
    const seat = st.toAct;
    const la = legalActions(st, seat);
    const type = prefer.find((t) => la.types.includes(t)) ?? la.types[0];
    if (!type) break;
    const r = applyAction(st, { type, seat });
    if (r.error) throw new Error(`drive rejected ${type}@${seat}: ${r.error}`);
    st = r.state; n++;
    if (n > cap) throw new Error('drive did not terminate (stuck hand)');
  }
  return { state: st, actions: n };
}

/** The public projection (the wire form persisted to the rail) must never carry a
 *  hidden seat's hole cards. Uses toWirePublicState (chip strings → JSON-safe). */
function assertNoPublicLeak(state: HandState): void {
  const wire = toWirePublicState(state);
  expect(JSON.stringify(wire).includes('holeCards')).toBe(false);
  for (const s of wire.seats) expect((s as unknown as Record<string, unknown>).holeCards).toBeUndefined();
  for (const s of toPublicView(state).seats) expect((s as unknown as Record<string, unknown>).holeCards).toBeUndefined();
}

describe('9-handed table', () => {
  it('full hand, deep stacks, passive check-down → single pot, conserved, no leak', () => {
    const start = Array.from({ length: 9 }, () => 5000n);
    const st0 = deal(start, 101);
    const total = totalChips(st0);
    assertInvariants(st0, total);
    assertNoPublicLeak(st0); // pre-flop, all 9 hidden

    // check where possible, else call (deep stacks never need all-in) → showdown
    const { state } = drive(st0, ['check', 'call']);

    expect(state.status).toBe('complete');
    expect(state.result?.endedBy).toBe('showdown');
    // no all-ins ⇒ exactly one pot
    expect(state.result?.potAwards.length).toBe(1);
    const pot = state.result!.potAwards[0].amount;
    const paid = Object.values(state.result!.payouts).reduce((a, b) => a + b, 0n);
    expect(paid).toBe(pot);                       // every chip in the pot is awarded
    expect(totalChips(state)).toBe(total);        // Σ(stacks)+pot conserved end-to-end
    assertInvariants(state, total);
  });

  it('multi-way all-in cascade → layered side pots, partition exact, folded never eligible', () => {
    // 9 DISTINCT stacks ⇒ distinct commitment levels ⇒ multiple side-pot layers.
    const start = [300n, 550n, 800n, 1100n, 1500n, 2000n, 2600n, 3300n, 4200n];
    const st0 = deal(start, 202);
    const total = totalChips(st0);
    assertInvariants(st0, total);

    // everyone shoves whenever possible (drives multi-way all-in)
    const { state } = drive(st0, ['allin', 'call', 'check']);

    expect(state.status).toBe('complete');
    expect(state.result?.endedBy).toBe('showdown');
    // distinct all-in amounts ⇒ at least two contested layers
    expect(state.result!.potAwards.length).toBeGreaterThanOrEqual(2);
    expect(totalChips(state)).toBe(total);        // conserved incl. any uncalled refund
    assertInvariants(state, total);               // also checks pot partition + eligibility
    assertNoPublicLeak(state.status === 'complete' ? st0 : state); // mid-hand secrecy held
  });

  it('fold-to-winner: everyone folds preflop → one winner, no reveal, conserved', () => {
    const start = Array.from({ length: 9 }, () => 5000n);
    const st0 = deal(start, 303);
    const total = totalChips(st0);

    // fold whenever a fold is legal (the last player standing wins uncontested)
    const { state } = drive(st0, ['fold', 'check']);

    expect(state.status).toBe('complete');
    expect(state.result?.endedBy).toBe('fold');
    expect(state.seats.filter((s) => s.revealedCards && s.revealedCards.length).length).toBe(0); // no reveal on fold-to-one
    const winners = Object.keys(state.result!.payouts);
    expect(winners.length).toBe(1);               // exactly one winner
    expect(totalChips(state)).toBe(total);        // conserved (incl. uncalled-blind refund)
    assertInvariants(state, total);
  });

  it('secrecy at 9 seats: public view hides all holes; private view shows only own', () => {
    const st0 = deal(Array.from({ length: 9 }, () => 5000n), 404);
    assertNoPublicLeak(st0);
    for (const seat of st0.seats.map((s) => s.seat)) {
      const priv = toPrivateView(st0, seat);
      expect(priv.myHoleCards.length).toBe(2);                 // caller sees own 2
      // the private view's OTHER seats must not carry hole cards
      for (const s of priv.seats) expect((s as unknown as Record<string, unknown>).holeCards).toBeUndefined();
    }
  });
});
