// tests/pokerEngine/pots.test.ts
// Side-pot construction, uncalled-bet refund, odd-chip distribution, conservation.

import { describe, it, expect } from 'vitest';
import { computeSidePots, refundUncalled, distribute, clockwiseSeatOrder } from '@engine/index.ts';
import { baseSeat, makeState, totalChips } from './fixtures.ts';

describe('computeSidePots', () => {
  it('2-way equal all-in => single pot, both eligible', () => {
    const st = makeState({
      seats: [
        baseSeat({ seat: 1, totalCommitted: 100n, status: 'allin' }),
        baseSeat({ seat: 2, totalCommitted: 100n, status: 'allin' }),
      ],
    });
    const pots = computeSidePots(st);
    expect(pots).toEqual([{ amount: 200n, eligibleSeats: [1, 2] }]);
  });

  it('3-way side pot (100 / 300 / 300)', () => {
    const st = makeState({
      seats: [
        baseSeat({ seat: 1, totalCommitted: 100n, status: 'allin' }),
        baseSeat({ seat: 2, totalCommitted: 300n, status: 'allin' }),
        baseSeat({ seat: 3, totalCommitted: 300n, status: 'active' }),
      ],
    });
    expect(computeSidePots(st)).toEqual([
      { amount: 300n, eligibleSeats: [1, 2, 3] },
      { amount: 400n, eligibleSeats: [2, 3] },
    ]);
  });

  it('3-level side pots (100 / 200 / 300)', () => {
    const st = makeState({
      seats: [
        baseSeat({ seat: 1, totalCommitted: 100n, status: 'allin' }),
        baseSeat({ seat: 2, totalCommitted: 200n, status: 'allin' }),
        baseSeat({ seat: 3, totalCommitted: 300n, status: 'allin' }),
      ],
    });
    expect(computeSidePots(st)).toEqual([
      { amount: 300n, eligibleSeats: [1, 2, 3] },
      { amount: 200n, eligibleSeats: [2, 3] },
      { amount: 100n, eligibleSeats: [3] },
    ]);
  });

  it('folded contributor stays as dead money but is never eligible', () => {
    const st = makeState({
      seats: [
        baseSeat({ seat: 1, totalCommitted: 100n, status: 'folded' }),
        baseSeat({ seat: 2, totalCommitted: 100n, status: 'active' }),
        baseSeat({ seat: 3, totalCommitted: 100n, status: 'active' }),
      ],
    });
    expect(computeSidePots(st)).toEqual([{ amount: 300n, eligibleSeats: [2, 3] }]);
  });
});

describe('refundUncalled', () => {
  it('refunds the uncalled excess of a lone top bettor', () => {
    const st = makeState({
      seats: [
        baseSeat({ seat: 1, stack: 0n, totalCommitted: 300n, status: 'active' }),
        baseSeat({ seat: 2, stack: 0n, totalCommitted: 100n, status: 'folded' }),
      ],
      pot: 400n,
    });
    const before = totalChips(st);
    const r = refundUncalled(st);
    expect(r).toEqual({ seat: 1, amount: 200n });
    expect(st.seats[0].stack).toBe(200n);
    expect(st.seats[0].totalCommitted).toBe(100n);
    expect(st.pot).toBe(200n);
    expect(totalChips(st)).toBe(before); // conserved
  });

  it('does not refund when the top is tied', () => {
    const st = makeState({
      seats: [
        baseSeat({ seat: 1, totalCommitted: 200n }),
        baseSeat({ seat: 2, totalCommitted: 200n }),
      ],
    });
    expect(refundUncalled(st)).toBeNull();
  });
});

describe('distribute (odd chip clockwise from button)', () => {
  it('gives the odd chip to the first winner clockwise from the button', () => {
    const st = makeState({
      seats: [
        baseSeat({ seat: 1, stack: 0n }),
        baseSeat({ seat: 2, stack: 0n }),
      ],
      pot: 101n,
      buttonSeat: 1,
    });
    expect(clockwiseSeatOrder(st.seats, 1)).toEqual([2, 1]);
    const before = totalChips(st);
    const shares = distribute(st, 101n, [1, 2], 1);
    expect(shares[2]).toBe(51n); // seat 2 (first clockwise from button) gets the odd chip
    expect(shares[1]).toBe(50n);
    expect(st.pot).toBe(0n);
    expect(totalChips(st)).toBe(before); // conserved
  });
});
