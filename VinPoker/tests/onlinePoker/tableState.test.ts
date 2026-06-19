// tests/onlinePoker/tableState.test.ts
// P0 repair — locks the leave/rejoin, empty-table, deal-signal and deal-target rules.
import { describe, it, expect } from 'vitest';
import {
  deriveMySeatNo, shouldDealSignal, filterLobbyTables, iAmInLiveHand, dealFlyCards,
} from '@/lib/onlinePoker/tableState';
import type { PublicHandView, PublicSeatView, LobbyTableSummary } from '@/lib/onlinePoker/types';

const pseat = (seat: number, over: Partial<PublicSeatView> = {}): PublicSeatView => ({
  seat, playerId: 'u' + seat, stack: '2000', committed: '0', status: 'active', ...over,
});
const hv = (over: Partial<PublicHandView> = {}): PublicHandView => ({
  handId: 'h1', tableId: 't1', handNo: 1, street: 'preflop', board: [], pot: '0',
  toActSeat: 1, buttonSeat: 1, status: 'betting', seats: [pseat(1), pseat(2)], ...over,
});

describe('deriveMySeatNo — live-seats authoritative (rejoin P0)', () => {
  const seats = [{ userId: 'u1', seatNo: 1 }, { userId: 'u2', seatNo: 2 }];
  it('returns my seat when I hold a live seat', () => {
    expect(deriveMySeatNo(seats, 'u1')).toBe(1);
  });
  it('returns null after I leave (my uid no longer in live seats) — even if a stale hand had me', () => {
    // there is intentionally no hand parameter: leaving = not in live seats = not seated.
    expect(deriveMySeatNo([{ userId: 'u2', seatNo: 2 }], 'u1')).toBeNull();
    expect(deriveMySeatNo([], 'u1')).toBeNull();
  });
  it('null with no uid', () => {
    expect(deriveMySeatNo(seats, null)).toBeNull();
  });
});

describe('shouldDealSignal — fresh-deal detection', () => {
  it('does NOT fire on the first snapshot (prevHandId null)', () => {
    expect(shouldDealSignal(null, hv()).fire).toBe(false);
  });
  it('fires once on a new hand with empty board and >=2 in-hand', () => {
    const r = shouldDealSignal('h0', hv({ handId: 'h1', board: [], seats: [pseat(1), pseat(2)] }));
    expect(r.fire).toBe(true);
    expect(r.dealSeats).toEqual([1, 2]);
  });
  it('does NOT fire on a re-poll of the same hand', () => {
    expect(shouldDealSignal('h1', hv({ handId: 'h1' })).fire).toBe(false);
  });
  it('does NOT fire when the board already has cards', () => {
    expect(shouldDealSignal('h0', hv({ handId: 'h1', board: ['Qh', 'Jd', 'Tc'] })).fire).toBe(false);
  });
  it('does NOT fire with fewer than 2 players in the hand', () => {
    expect(shouldDealSignal('h0', hv({ handId: 'h1', seats: [pseat(1), pseat(2, { status: 'sitting_out' })] })).fire).toBe(false);
  });
});

describe('filterLobbyTables — hide empty tables', () => {
  const t = (id: string, seatedCount: number): LobbyTableSummary => ({ id, name: id, sb: '25', bb: '50', maxSeats: 9, seatedCount, status: 'open' });
  it('hides 0-seated tables, keeps host/created tables (>=1)', () => {
    expect(filterLobbyTables([t('a', 0), t('b', 1), t('c', 3)]).map((x) => x.id)).toEqual(['b', 'c']);
  });
});

describe('iAmInLiveHand — leave gate', () => {
  it('true only when my seat is active/allin in a live hand', () => {
    expect(iAmInLiveHand(hv({ status: 'betting', seats: [pseat(1, { status: 'active' })] }), 1)).toBe(true);
    expect(iAmInLiveHand(hv({ status: 'betting', seats: [pseat(1, { status: 'allin' })] }), 1)).toBe(true);
  });
  it('false when I am only sitting out / not in the hand', () => {
    expect(iAmInLiveHand(hv({ status: 'betting', seats: [pseat(1, { status: 'sitting_out' })] }), 1)).toBe(false);
    expect(iAmInLiveHand(hv({ status: 'betting', seats: [pseat(2, { status: 'active' })] }), 1)).toBe(false);
  });
  it('false when no hand / not seated / hand complete', () => {
    expect(iAmInLiveHand(null, 1)).toBe(false);
    expect(iAmInLiveHand(hv({ status: 'betting' }), null)).toBe(false);
    expect(iAmInLiveHand(hv({ status: 'complete', seats: [pseat(1, { status: 'active' })] }), 1)).toBe(false);
  });
});

describe('dealFlyCards — only to occupied seats', () => {
  const pos = { 1: { x: 50, y: 90 }, 2: { x: 90, y: 50 }, 3: { x: 10, y: 50 }, 4: { x: 50, y: 10 } };
  it('flies 2 rounds to the given seats only — never to empty chairs', () => {
    const cards = dealFlyCards([1, 2], pos);
    expect(cards).toHaveLength(4); // 2 seats × 2 rounds
    // every card lands on seat 1 or 2's position; none on 3/4
    const targets = new Set(cards.map((c) => `${c.x},${c.y}`));
    expect(targets).toEqual(new Set(['50,90', '90,50']));
  });
  it('ignores seats with no position', () => {
    expect(dealFlyCards([1, 99], pos)).toHaveLength(2); // only seat 1 has a pos → 1×2 rounds
  });
});
