// supabase/functions/_shared/pokerEngine/pots.ts
// Side-pot construction, uncalled-bet refund, and clockwise odd-chip ordering.
// Pure; mutating helpers move chips pot<->stack so the invariant
//   Σ(seat.stack) + pot === initialTotal
// holds before AND after (refund: pot -> stack).

import type { HandState, SeatState, SidePot } from './types.ts';
import { seatsInClockwiseOrder } from './betting.ts';

/**
 * Build main + side pots from each seat's totalCommitted (across all streets).
 * Folded seats' chips stay in the pots (dead money) but folded seats are NEVER
 * eligible. Σ(side-pot amounts) === Σ(totalCommitted) === pot (after refund).
 */
export function computeSidePots(state: HandState): SidePot[] {
  const contributors = state.seats
    .filter((s) => s.totalCommitted > 0n)
    .map((s) => ({ seat: s.seat, amt: s.totalCommitted, folded: s.status === 'folded' }));
  if (contributors.length === 0) return [];

  const levels = [...new Set(contributors.map((c) => c.amt))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const pots: SidePot[] = [];
  let prev = 0n;
  for (const L of levels) {
    let count = 0;
    const eligible: number[] = [];
    for (const c of contributors) {
      if (c.amt >= L) {
        count++;
        if (!c.folded) eligible.push(c.seat);
      }
    }
    const amount = (L - prev) * BigInt(count);
    if (amount > 0n) pots.push({ amount, eligibleSeats: eligible });
    prev = L;
  }
  return pots;
}

/**
 * Refund the uncalled top portion of the last bet to its owner. If exactly one
 * seat committed strictly more than everyone else, the excess was never matched
 * and is returned to that seat (pot -> stack). Returns the refunded amount.
 */
export function refundUncalled(state: HandState): { seat: number; amount: bigint } | null {
  const inPlay = state.seats.filter((s) => s.totalCommitted > 0n);
  if (inPlay.length < 2) {
    // pathological: a single contributor — refund everything to them
    const only = inPlay[0];
    if (!only || only.totalCommitted === 0n) return null;
    const amt = only.totalCommitted;
    only.stack += amt;
    only.totalCommitted -= amt;
    state.pot -= amt;
    return { seat: only.seat, amount: amt };
  }
  const sorted = [...inPlay].sort((a, b) => (a.totalCommitted < b.totalCommitted ? 1 : a.totalCommitted > b.totalCommitted ? -1 : 0));
  const top = sorted[0];
  const second = sorted[1].totalCommitted;
  const topCount = state.seats.filter((s) => s.totalCommitted === top.totalCommitted).length;
  if (topCount === 1 && top.totalCommitted > second) {
    const excess = top.totalCommitted - second;
    top.stack += excess;
    top.totalCommitted -= excess;
    state.pot -= excess;
    return { seat: top.seat, amount: excess };
  }
  return null;
}

/** Seat numbers in clockwise order starting at the seat AFTER the button. */
export function clockwiseSeatOrder(seats: SeatState[], buttonSeat: number): number[] {
  const ordered = seatsInClockwiseOrder(seats);
  const idx = ordered.findIndex((s) => s.seat === buttonSeat);
  const start = idx < 0 ? 0 : idx + 1;
  const out: number[] = [];
  for (let k = 0; k < ordered.length; k++) out.push(ordered[(start + k) % ordered.length].seat);
  return out;
}

/**
 * Split `amount` among `winners`, giving any odd remainder chip-by-chip to the
 * winners nearest clockwise from the button (standard rule). Credits stacks and
 * reduces pot. Returns per-seat shares.
 */
export function distribute(
  state: HandState,
  amount: bigint,
  winners: number[],
  buttonSeat: number,
): Record<number, bigint> {
  const shares: Record<number, bigint> = {};
  const k = BigInt(winners.length);
  const base = amount / k;
  let rem = amount % k;
  const order = clockwiseSeatOrder(state.seats, buttonSeat).filter((sn) => winners.includes(sn));
  for (const seatNo of order) {
    let share = base;
    if (rem > 0n) { share += 1n; rem -= 1n; }
    const s = state.seats.find((x) => x.seat === seatNo)!;
    s.stack += share;
    state.pot -= share;
    shares[seatNo] = (shares[seatNo] ?? 0n) + share;
  }
  return shares;
}
