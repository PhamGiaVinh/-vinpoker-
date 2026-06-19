// tests/onlinePoker/pokerSounds.test.ts
// PR C — derivePokerSounds is the conservative, pure brain behind opponent sound cues.
// These lock its safety guarantees: [] on the first snapshot, a single deal on a new
// hand / community card, fold/call/raise/all_in detection, mySeat skipped (no double),
// and a STRICT check (only when the evidence is unambiguous).
import { describe, it, expect } from 'vitest';
import { derivePokerSounds, actionToSound } from '@/lib/onlinePoker/pokerSounds';
import type { PublicHandView, PublicSeatView } from '@/lib/onlinePoker/types';

const seat = (n: number, over: Partial<PublicSeatView> = {}): PublicSeatView => ({
  seat: n, playerId: 'u' + n, stack: '2000', committed: '0', status: 'active', ...over,
});
const hv = (over: Partial<PublicHandView> = {}): PublicHandView => ({
  handId: 'h1', tableId: 't1', handNo: 1, street: 'preflop', board: [], pot: '0',
  toActSeat: 1, buttonSeat: 1, status: 'betting', seats: [seat(1), seat(2)], ...over,
});

describe('actionToSound', () => {
  it('maps every action type', () => {
    expect(actionToSound('fold')).toBe('fold');
    expect(actionToSound('check')).toBe('check');
    expect(actionToSound('call')).toBe('call');
    expect(actionToSound('bet')).toBe('bet');
    expect(actionToSound('raise')).toBe('raise');
    expect(actionToSound('allin')).toBe('all_in');
  });
});

describe('derivePokerSounds — safety', () => {
  it('returns [] on the first snapshot (prev null)', () => {
    expect(derivePokerSounds(null, hv(), 1)).toEqual([]);
  });
  it('returns [] when next is null', () => {
    expect(derivePokerSounds(hv(), null, 1)).toEqual([]);
  });
  it('an identical poll yields no sound (natural de-dup)', () => {
    const a = hv();
    expect(derivePokerSounds(a, hv(), 1)).toEqual([]);
  });
  it('skips MY own seat (I sound on submit)', () => {
    const prev = hv({ seats: [seat(1, { committed: '0' }), seat(2)] });
    const next = hv({ seats: [seat(1, { committed: '150' }), seat(2)] });
    expect(derivePokerSounds(prev, next, 1)).toEqual([]); // seat 1 is mine → silent
  });
});

describe('derivePokerSounds — deal cues', () => {
  it('a new hand → one deal', () => {
    expect(derivePokerSounds(hv({ handId: 'h1' }), hv({ handId: 'h2' }), 1)).toEqual(['deal']);
  });
  it('community cards dealt (same hand, board grows) → deal', () => {
    const prev = hv({ board: [] });
    const next = hv({ board: ['Qh', 'Jd', 'Tc'], street: 'flop' });
    expect(derivePokerSounds(prev, next, 1)).toEqual(['deal']);
  });
});

describe('derivePokerSounds — opponent actions (mySeat = 1)', () => {
  it('fold', () => {
    const prev = hv({ seats: [seat(1), seat(2, { status: 'active' })] });
    const next = hv({ seats: [seat(1), seat(2, { status: 'folded' })] });
    expect(derivePokerSounds(prev, next, 1)).toEqual(['fold']);
  });
  it('call (matches the current bet)', () => {
    const prev = hv({ seats: [seat(1, { committed: '50' }), seat(2, { committed: '0' })] });
    const next = hv({ seats: [seat(1, { committed: '50' }), seat(2, { committed: '50' })] });
    expect(derivePokerSounds(prev, next, 1)).toEqual(['call']);
  });
  it('raise (exceeds the current bet)', () => {
    const prev = hv({ seats: [seat(1, { committed: '50' }), seat(2, { committed: '0' })] });
    const next = hv({ seats: [seat(1, { committed: '50' }), seat(2, { committed: '150' })] });
    expect(derivePokerSounds(prev, next, 1)).toEqual(['raise']);
  });
  it('all-in (stack to zero)', () => {
    const prev = hv({ seats: [seat(1, { committed: '50' }), seat(2, { committed: '0', stack: '2000' })] });
    const next = hv({ seats: [seat(1, { committed: '50' }), seat(2, { committed: '2000', stack: '0', status: 'allin' })] });
    expect(derivePokerSounds(prev, next, 1)).toEqual(['all_in']);
  });
});

describe('derivePokerSounds — check is strict', () => {
  it('emits check only when that seat was to act and nothing else changed', () => {
    const prev = hv({ toActSeat: 2, seats: [seat(1), seat(2)] });
    const next = hv({ toActSeat: 1, seats: [seat(1), seat(2)] });
    expect(derivePokerSounds(prev, next, 1)).toEqual(['check']);
  });
  it('stays silent if the street changed (ambiguous)', () => {
    const prev = hv({ toActSeat: 2, street: 'preflop', board: [] });
    const next = hv({ toActSeat: 1, street: 'flop', board: ['Qh', 'Jd', 'Tc'] });
    // board grew → deal; but NO check (street changed)
    expect(derivePokerSounds(prev, next, 1)).toEqual(['deal']);
  });
});
