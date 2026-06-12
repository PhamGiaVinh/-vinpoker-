// tests/pokerEngine/showdown.test.ts
// Showdown payout: single winner, split pot, side pots with different winners,
// reveal-only-contenders, chip conservation.

import { describe, it, expect } from 'vitest';
import { evaluateShowdown } from '@engine/index.ts';
import type { Card } from '@engine/index.ts';
import { baseSeat, makeState, totalChips } from './fixtures.ts';

describe('evaluateShowdown', () => {
  it('awards the whole pot to the single best hand', () => {
    const board: Card[] = ['Ah', 'Kd', '7s', '2c', '3d'];
    const st = makeState({
      board,
      buttonSeat: 1,
      seats: [
        baseSeat({ seat: 1, stack: 0n, totalCommitted: 100n, status: 'allin', holeCards: ['As', 'Ad'] }), // trip A
        baseSeat({ seat: 2, stack: 0n, totalCommitted: 100n, status: 'allin', holeCards: ['Kh', 'Ks'] }), // trip K
      ],
    });
    const before = totalChips(st);
    evaluateShowdown(st);
    expect(st.status).toBe('complete');
    expect(st.result?.endedBy).toBe('showdown');
    expect(st.seats[0].stack).toBe(200n);
    expect(st.seats[1].stack).toBe(0n);
    expect(totalChips(st)).toBe(before);
    // both contenders reveal
    expect(st.seats[0].revealedCards).toEqual(['As', 'Ad']);
    expect(st.seats[1].revealedCards).toEqual(['Kh', 'Ks']);
  });

  it('splits a tied pot evenly', () => {
    const board: Card[] = ['Ah', 'Kd', 'Qs', 'Jc', 'Td']; // broadway on board
    const st = makeState({
      board,
      buttonSeat: 1,
      seats: [
        baseSeat({ seat: 1, stack: 0n, totalCommitted: 100n, status: 'allin', holeCards: ['2c', '3d'] }),
        baseSeat({ seat: 2, stack: 0n, totalCommitted: 100n, status: 'allin', holeCards: ['2h', '3s'] }),
      ],
    });
    const before = totalChips(st);
    evaluateShowdown(st);
    expect(st.seats[0].stack).toBe(100n);
    expect(st.seats[1].stack).toBe(100n);
    expect(totalChips(st)).toBe(before);
  });

  it('resolves main and side pots with different winners', () => {
    const board: Card[] = ['Ah', 'Kd', '7s', '2c', '3d'];
    const st = makeState({
      board,
      buttonSeat: 1,
      seats: [
        baseSeat({ seat: 1, stack: 0n, totalCommitted: 100n, status: 'allin', holeCards: ['As', 'Ad'] }), // trip A — best
        baseSeat({ seat: 2, stack: 0n, totalCommitted: 300n, status: 'allin', holeCards: ['Kh', 'Ks'] }), // trip K — 2nd
        baseSeat({ seat: 3, stack: 0n, totalCommitted: 300n, status: 'active', holeCards: ['7h', '7d'] }), // trip 7 — worst
      ],
    });
    const before = totalChips(st);
    evaluateShowdown(st);
    // main pot 300 (A,B,C eligible) -> A ; side pot 400 (B,C eligible) -> B
    expect(st.result?.payouts[1]).toBe(300n);
    expect(st.result?.payouts[2]).toBe(400n);
    expect(st.result?.payouts[3] ?? 0n).toBe(0n);
    expect(st.seats[0].stack).toBe(300n);
    expect(st.seats[1].stack).toBe(400n);
    expect(st.seats[2].stack).toBe(0n);
    expect(totalChips(st)).toBe(before);
  });
});
