// tests/onlinePoker/allinCinematic.test.ts
import { describe, it, expect } from 'vitest';
import {
  ALLIN_CINEMATIC_PHASES, ALLIN_CINEMATIC_TOTAL_MS, isAllInShowdown, planAllInCinematic,
} from '@/lib/onlinePoker/allinCinematic';
import type { PublicHandView } from '@/lib/onlinePoker/types';

function allInHand(): PublicHandView {
  return {
    handId: 'h', tableId: 't', handNo: 1, street: 'showdown',
    board: ['2s', 'Qd', 'Ad', '3d', '4h'], pot: '0', toActSeat: null, buttonSeat: 1, status: 'complete',
    result: { endedBy: 'showdown', potTotal: '20000', potAwards: [{ potIndex: 0, amount: '20000', winners: [2] }], payouts: { 2: '20000' } },
    seats: [
      { seat: 1, playerId: 'a', displayName: 'An', stack: '0', committed: '0', status: 'allin', revealedCards: ['8s', 'Tc'] },
      { seat: 2, playerId: 'b', displayName: 'Bình', stack: '20000', committed: '0', status: 'allin', revealedCards: ['Ac', '5d'] },
    ],
    mySeat: 1, myHoleCards: ['8s', 'Tc'],
  };
}

describe('cinematic timeline', () => {
  it('board reveals 0 → 3 → 4 → 5 in order', () => {
    expect(ALLIN_CINEMATIC_PHASES.map((p) => p.boardVisible)).toEqual([0, 0, 0, 3, 3, 4, 4, 5, 5]);
  });
  it('hole reveals go 0 → 1 → 2 then stay 2', () => {
    expect(ALLIN_CINEMATIC_PHASES.map((p) => p.revealCount)).toEqual([0, 1, 2, 2, 2, 2, 2, 2, 2]);
  });
  it('equity only from the flop on (0 = preflop hidden)', () => {
    expect(ALLIN_CINEMATIC_PHASES.map((p) => p.equityBoardLen)).toEqual([0, 0, 0, 3, 3, 4, 4, 5, 5]);
  });
  it('the result is the LAST phase only — no full board shown before the river reveal', () => {
    const last = ALLIN_CINEMATIC_PHASES[ALLIN_CINEMATIC_PHASES.length - 1];
    expect(last.key).toBe('final_result');
    // every phase before the river (index 7) shows fewer than 5 board cards
    expect(ALLIN_CINEMATIC_PHASES.slice(0, 7).every((p) => p.boardVisible < 5)).toBe(true);
    expect(ALLIN_CINEMATIC_PHASES.filter((p) => p.key === 'final_result')).toHaveLength(1);
  });
  it('total = sum of phase durations', () => {
    expect(ALLIN_CINEMATIC_TOTAL_MS).toBe(ALLIN_CINEMATIC_PHASES.reduce((a, p) => a + p.durationMs, 0));
  });
});

describe('isAllInShowdown + planAllInCinematic', () => {
  it('detects a 2-player all-in showdown', () => {
    expect(isAllInShowdown(allInHand())).toBe(true);
  });
  it('rejects a fold win (endedBy fold, no reveals)', () => {
    const h = allInHand();
    h.result = { ...h.result!, endedBy: 'fold' };
    h.board = [];
    h.seats = h.seats.map((s) => ({ ...s, revealedCards: undefined }));
    expect(isAllInShowdown(h)).toBe(false);
  });
  it('rejects a checked-down showdown (no all-in seat)', () => {
    const h = allInHand();
    h.seats = h.seats.map((s) => ({ ...s, status: 'active' }));
    expect(isAllInShowdown(h)).toBe(false);
  });
  it('rejects an incomplete hand', () => {
    const h = allInHand();
    h.status = 'betting';
    expect(isAllInShowdown(h)).toBe(false);
  });
  it('plans heads-up: reveal order by seat, headsUp=true', () => {
    const p = planAllInCinematic(allInHand());
    expect(p.isAllInShowdown).toBe(true);
    expect(p.revealOrder).toEqual([1, 2]);
    expect(p.headsUp).toBe(true);
  });
  it('marks 3-way all-in as NOT heads-up (equity hidden for multiway)', () => {
    const h = allInHand();
    h.seats.push({ seat: 3, playerId: 'c', displayName: 'Cường', stack: '0', committed: '0', status: 'allin', revealedCards: ['Kh', 'Qs'] });
    const p = planAllInCinematic(h);
    expect(p.headsUp).toBe(false);
    expect(p.revealOrder).toEqual([1, 2, 3]);
  });
});
