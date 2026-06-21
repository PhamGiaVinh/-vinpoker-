// tests/pokerEngine/sidePotContract.test.ts
// IDEA-5 contract lock: the UNCALLED bet is always kept OUTSIDE the awarded pot
// layers, and the live `sidePots` is a PROVISIONAL partition (Σ === pot during
// betting, emptied at completion). These guarantees were verified by reading the
// engine; this file pins them so a future refactor cannot silently fold an
// uncalled overhang into a winnable layer.
//
// WHY there is no live "uncalled" field on the wire: the refund-detection rule
// (refundUncalled) is only valid AT SETTLEMENT. Applied to an open betting state
// it would mis-flag the unmatched BIG BLIND as "uncalled" (e.g. right after
// blinds the BB is the lone top contributor though the SB/button still owe the
// call). The engine also closes any round the instant no one can call, so a
// `betting` state never carries a stable standing overhang. The uncalled amount
// is therefore a settlement-time concept only — surfaced by refunding it to the
// bettor's stack BEFORE the pots are built, never as a contested pot.

import { describe, it, expect } from 'vitest';
import { checkInvariants } from '@engine/index.ts';
import { freshHand, play } from './fixtures.ts';

describe('uncalled bet stays OUTSIDE the awarded pot layers', () => {
  it('showdown: a lone over-shove is refunded, not awarded (pot excludes it)', () => {
    // Heads-up: seat1 (SB/button) covers seat2. seat1 shoves 1000; seat2 can only
    // call 300 all-in. The uncalled 700 must come back to seat1 and never enter a pot.
    const st = freshHand([1000n, 300n], { button: 1, sb: 50n, bb: 100n });
    const { state: end } = play(st, [
      { type: 'allin', seat: 1 }, // to 1000
      { type: 'allin', seat: 2 }, // call all-in for 300
    ]);

    expect(end.status).toBe('complete');
    expect(end.sidePots).toEqual([]);                 // no live partition once complete

    const potTotal = end.result!.potTotal;
    expect(potTotal).toBe(600n);                       // only the matched 300+300 is contested
    expect(1300n - potTotal).toBe(700n);               // the uncalled 700 sits OUTSIDE the pot

    const awardSum = end.result!.potAwards.reduce((a, x) => a + x.amount, 0n);
    expect(awardSum).toBe(potTotal);                   // no award layer carries the uncalled chips

    const paid = Object.values(end.result!.payouts).reduce((a, x) => a + x, 0n);
    expect(paid).toBe(potTotal);                       // payouts == contested pot only

    // seat1 always keeps at least its 700 refund (plus any pot it then wins).
    expect(end.seats.find((s) => s.seat === 1)!.stack).toBeGreaterThanOrEqual(700n);
    expect(end.seats.reduce((a, s) => a + s.stack, 0n)).toBe(1300n); // conserved
    expect(checkInvariants(end, 1300n)).toEqual([]);
  });

  it('fold-to-one: the uncalled raise is refunded before the pot is awarded', () => {
    const hu = freshHand([1000n, 1000n], { button: 1, sb: 50n, bb: 100n });
    const { state: end } = play(hu, [
      { type: 'raise', seat: 1, amount: 300n }, // seat1 commits 300
      { type: 'fold', seat: 2 },                // seat2 (committed 100) folds
    ]);

    expect(end.status).toBe('complete');
    expect(end.result!.endedBy).toBe('fold');
    expect(end.result!.potTotal).toBe(200n);           // 100 matched + 100 dead money; uncalled 200 refunded
    expect(end.sidePots).toEqual([]);
    // seat1: 1000 - 300 committed + 200 refund + 200 award = 1100; seat2: 1000 - 100 = 900.
    expect(end.seats.find((s) => s.seat === 1)!.stack).toBe(1100n);
    expect(end.seats.find((s) => s.seat === 2)!.stack).toBe(900n);
    expect(checkInvariants(end, 2000n)).toEqual([]);
  });
});

describe('live sidePots is a provisional partition (Σ === pot during betting)', () => {
  it('sums to the gross pot mid-hand and is empty once complete', () => {
    const mid = freshHand([1000n, 1000n, 1000n], { button: 1, sb: 50n, bb: 100n });
    expect(mid.status).toBe('betting');
    expect(mid.sidePots.reduce((a, p) => a + p.amount, 0n)).toBe(mid.pot);

    // play it to a fold-to-one completion; the provisional partition then clears.
    const { state: end } = play(mid, [
      { type: 'fold', seat: 1 }, // UTG/button folds (3-handed: seat1=button, toAct=seat1)
      { type: 'fold', seat: 2 }, // SB folds -> BB wins
    ]);
    expect(end.status).toBe('complete');
    expect(end.sidePots).toEqual([]);
    expect(checkInvariants(end, 3000n)).toEqual([]);
  });
});
