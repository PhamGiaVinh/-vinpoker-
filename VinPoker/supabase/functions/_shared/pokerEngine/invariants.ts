// supabase/functions/_shared/pokerEngine/invariants.ts
//
// Runtime invariant checker for HandState — defense-in-depth for the server
// runtime and the replay/audit path. Pure and read-only: it never mutates the
// state it inspects. The engine's reducers are already property-tested; this
// module lets the PERSISTENCE layer (and replays of stored hands) cheaply
// verify that a state it loaded or produced is still self-consistent before
// trusting it.
//
// The one conservation invariant (locked): Σ(seat.stack) + pot === initialTotal.
// NEVER add `committed` — those chips are already inside `pot` (gross-pot rule).

import type { HandState } from './types.ts';
import { isCard } from './deck.ts';

/**
 * Check every structural invariant. Returns a list of human-readable
 * violations — empty means the state is consistent. Pass `initialTotal`
 * (Σ of all seats' starting stacks) to also check chip conservation.
 */
export function checkInvariants(state: HandState, initialTotal?: bigint): string[] {
  const v: string[] = [];
  const seats = state.seats;

  // ── per-seat chip sanity ──
  for (const s of seats) {
    if (s.stack < 0n) v.push(`seat ${s.seat}: negative stack ${s.stack}`);
    if (s.committed < 0n) v.push(`seat ${s.seat}: negative committed ${s.committed}`);
    if (s.totalCommitted < 0n) v.push(`seat ${s.seat}: negative totalCommitted ${s.totalCommitted}`);
    if (s.committed > s.totalCommitted) {
      v.push(`seat ${s.seat}: committed ${s.committed} > totalCommitted ${s.totalCommitted}`);
    }
    // Only during betting: at completion, refunds/payouts legitimately restore
    // chips to a seat whose status remains 'allin' (the engine does not flip it back).
    if (state.status === 'betting' && s.status === 'allin' && s.stack !== 0n) {
      v.push(`seat ${s.seat}: allin with non-zero stack ${s.stack} during betting`);
    }
    if (s.holeCards.length !== 0 && s.holeCards.length !== 2) {
      v.push(`seat ${s.seat}: holeCards length ${s.holeCards.length} (must be 0 or 2)`);
    }
  }

  // ── pot sanity + conservation ──
  if (state.pot < 0n) v.push(`negative pot ${state.pot}`);
  const sumStacks = seats.reduce((a, s) => a + s.stack, 0n);
  if (initialTotal !== undefined && sumStacks + state.pot !== initialTotal) {
    v.push(`chip conservation broken: stacks ${sumStacks} + pot ${state.pot} !== initial ${initialTotal}`);
  }

  // ── card integrity: no card appears twice across board/holeCards/deck ──
  const seen = new Map<string, string>();
  const claim = (card: string, where: string) => {
    if (!isCard(card)) v.push(`${where}: invalid card ${JSON.stringify(card)}`);
    const prior = seen.get(card);
    if (prior) v.push(`duplicate card ${card} in ${prior} and ${where}`);
    else seen.set(card, where);
  };
  state.board.forEach((c) => claim(c, 'board'));
  for (const s of seats) s.holeCards.forEach((c) => claim(c, `seat ${s.seat} holeCards`));
  state.deck.forEach((c) => claim(c, 'deck'));

  // ── turn pointer ──
  if (state.status === 'betting') {
    if (state.toAct === null) {
      v.push('betting status with no seat to act');
    } else {
      const actor = seats.find((s) => s.seat === state.toAct);
      if (!actor) v.push(`toAct points at unknown seat ${state.toAct}`);
      else if (actor.status !== 'active') v.push(`toAct seat ${state.toAct} is ${actor.status}, not active`);
    }
    // during betting no refunds have happened: every committed chip is in the gross pot
    const sumTotalCommitted = seats.reduce((a, s) => a + s.totalCommitted, 0n);
    if (sumTotalCommitted !== state.pot) {
      v.push(`Σ totalCommitted ${sumTotalCommitted} !== pot ${state.pot} during betting`);
    }
  }

  // ── side pots (live partition during betting) ──
  if (state.sidePots.length > 0) {
    let potSum = 0n;
    for (const [i, p] of state.sidePots.entries()) {
      potSum += p.amount;
      if (p.amount <= 0n) v.push(`side pot ${i}: non-positive amount ${p.amount}`);
      if (p.eligibleSeats.length === 0) v.push(`side pot ${i}: no eligible seats`);
      for (const sn of p.eligibleSeats) {
        const s = seats.find((x) => x.seat === sn);
        if (!s) v.push(`side pot ${i}: eligible seat ${sn} does not exist`);
        else if (s.status === 'folded') v.push(`side pot ${i}: folded seat ${sn} is eligible`);
      }
    }
    if (state.status === 'betting' && potSum !== state.pot) {
      v.push(`side pots sum ${potSum} !== pot ${state.pot}`);
    }
  }

  // ── completion ──
  if (state.status === 'complete') {
    if (state.toAct !== null) v.push(`complete hand with toAct=${state.toAct}`);
    if (state.pot !== 0n) v.push(`complete hand with undistributed pot ${state.pot}`);
    if (!state.result) {
      v.push('complete hand without a result');
    } else {
      const paid = Object.values(state.result.payouts).reduce((a, x) => a + x, 0n);
      if (paid !== state.result.potTotal) {
        v.push(`payouts ${paid} !== potTotal ${state.result.potTotal}`);
      }
      for (const a of state.result.potAwards) {
        if (a.winners.length === 0) v.push(`pot award ${a.potIndex}: no winners`);
      }
    }
  }

  return v;
}

/** Throw (with every violation listed) if the state is inconsistent. */
export function assertInvariants(state: HandState, initialTotal?: bigint): void {
  const v = checkInvariants(state, initialTotal);
  if (v.length > 0) {
    throw new Error(`HandState invariant violation(s):\n- ${v.join('\n- ')}`);
  }
}
