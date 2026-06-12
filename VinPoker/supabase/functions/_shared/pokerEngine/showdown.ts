// supabase/functions/_shared/pokerEngine/showdown.ts
// Showdown resolution: refund uncalled, build side pots, evaluate each pot
// independently, split ties with the odd chip going clockwise from the button,
// reveal ONLY contesting seats' cards (folded/mucked stay hidden).

import type { HandEvent, HandState, PotAward } from './types.ts';
import { compareRankVec, evaluateBest } from './evaluate.ts';
import { computeSidePots, distribute, refundUncalled } from './pots.ts';
import { handComplete, potAwarded, showdownEvent } from './events.ts';

export function evaluateShowdown(state: HandState): HandEvent[] {
  refundUncalled(state);

  const pots = computeSidePots(state);
  const potTotal = state.pot; // after refund == Σ totalCommitted
  const awards: PotAward[] = [];
  const payouts: Record<number, bigint> = {};
  const revealSet = new Set<number>();

  pots.forEach((pot, i) => {
    const contenders = pot.eligibleSeats; // never folded
    let best: number[] | null = null;
    let winners: number[] = [];
    for (const seatNo of contenders) {
      const s = state.seats.find((x) => x.seat === seatNo)!;
      const rankVec = evaluateBest([...s.holeCards, ...state.board]).rankVec;
      const cmp = best === null ? 1 : compareRankVec(rankVec, best);
      if (cmp > 0) { best = rankVec; winners = [seatNo]; }
      else if (cmp === 0) winners.push(seatNo);
    }
    const shares = distribute(state, pot.amount, winners, state.buttonSeat);
    for (const sn of Object.keys(shares)) payouts[+sn] = (payouts[+sn] ?? 0n) + shares[+sn];
    awards.push({ potIndex: i, amount: pot.amount, winners });
    contenders.forEach((sn) => revealSet.add(sn));
  });

  const reveals: { seat: number; cards: typeof state.board }[] = [];
  for (const seatNo of revealSet) {
    const s = state.seats.find((x) => x.seat === seatNo)!;
    s.revealedCards = [...s.holeCards];
    reveals.push({ seat: seatNo, cards: [...s.holeCards] });
  }

  state.street = 'showdown';
  state.status = 'complete';
  state.result = { endedBy: 'showdown', potTotal, potAwards: awards, payouts };

  return [showdownEvent(reveals), potAwarded(awards), handComplete('showdown', potTotal)];
}
