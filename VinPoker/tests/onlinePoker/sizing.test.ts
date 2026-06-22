// tests/onlinePoker/sizing.test.ts
// GE-2D — the player-bar bet-sizing helpers are pure + fail-closed. They only ever
// produce canonical chip strings inside the server's legal [minRaiseTo, maxRaiseTo]
// window (the server stays the source of truth). These tests pin the GG-style
// %-pot math, the clamping, the malformed-input guards, and the BB display helper.

import { describe, it, expect } from 'vitest';
import { betSizingOptions, clampRaiseTo, fmtBB } from '@/lib/onlinePoker/sizing';
import type { WireLegalActions } from '@/lib/onlinePoker/wire';

const CHIP = /^(0|[1-9][0-9]*)$/;
const legal = (over: Partial<WireLegalActions> = {}): WireLegalActions => ({
  seat: 3, types: ['fold', 'call', 'raise', 'allin'],
  toCall: '150', canCheck: false, minRaiseTo: '300', maxRaiseTo: '1700', ...over,
});

describe('betSizingOptions — %-pot math (raise to = toCall + pct·(pot+toCall))', () => {
  it('computes 33% / 50% / 75% / 100% for a normal window', () => {
    // pot 475, toCall 150 → potAfterCall 625; min 300, max 1700
    const o = betSizingOptions(legal(), { pot: '475' });
    expect(o.map((x) => [x.key, x.amount])).toEqual([
      ['33', '356'],   // 150 + 625·33/100 = 356 (floor)
      ['50', '462'],   // 150 + 625·50/100 = 462 (floor)
      ['75', '618'],   // 150 + 625·75/100 = 618 (floor)
      ['100', '775'],  // 150 + 625
    ]);
    expect(o.map((x) => x.label)).toEqual(['33%', '50%', '75%', '100%']);
  });

  it('every amount sits within [minRaiseTo, maxRaiseTo]', () => {
    const o = betSizingOptions(legal({ minRaiseTo: '300', maxRaiseTo: '1700' }), { pot: '475' });
    for (const x of o) {
      expect(Number(x.amount)).toBeGreaterThanOrEqual(300);
      expect(Number(x.amount)).toBeLessThanOrEqual(1700);
    }
  });

  it('clamps fractions that exceed maxRaiseTo down to the cap (huge pot → all = max, de-duped)', () => {
    const o = betSizingOptions(legal({ minRaiseTo: '200', maxRaiseTo: '500' }), { pot: '100000' });
    expect(o.map((x) => x.amount)).toEqual(['500']);
  });

  it('clamps fractions below minRaiseTo up to the floor (tiny pot → all = min, de-duped)', () => {
    const o = betSizingOptions(legal({ toCall: '0', minRaiseTo: '1000', maxRaiseTo: '5000' }), { pot: '10' });
    expect(o.map((x) => x.amount)).toEqual(['1000']);
  });

  it('every emitted amount is a canonical chip string (no NaN / negative / leading zeros)', () => {
    for (const pot of ['0', '1', '475', '999999999999999999']) {
      for (const x of betSizingOptions(legal(), { pot })) expect(x.amount).toMatch(CHIP);
    }
  });
});

describe('betSizingOptions — fail-closed', () => {
  it('returns [] when neither bet nor raise is legal', () => {
    expect(betSizingOptions(legal({ types: ['fold', 'call'] }), { pot: '475' })).toEqual([]);
    expect(betSizingOptions(legal({ types: ['fold', 'check'] }), { pot: '475' })).toEqual([]);
  });

  it('returns [] on any malformed chip string (toCall / min / max / pot)', () => {
    expect(betSizingOptions(legal({ toCall: '-1' }), { pot: '475' })).toEqual([]);
    expect(betSizingOptions(legal({ minRaiseTo: '' }), { pot: '475' })).toEqual([]);
    expect(betSizingOptions(legal({ maxRaiseTo: '1.5' }), { pot: '475' })).toEqual([]);
    expect(betSizingOptions(legal({ maxRaiseTo: '007' }), { pot: '475' })).toEqual([]);
    expect(betSizingOptions(legal(), { pot: 'x' })).toEqual([]);
  });

  it('returns [] on a degenerate window (max < min)', () => {
    expect(betSizingOptions(legal({ minRaiseTo: '1700', maxRaiseTo: '300' }), { pot: '475' })).toEqual([]);
  });
});

describe('clampRaiseTo (slider value → legal window)', () => {
  it('keeps an in-range amount, clamps out-of-range to the nearest bound', () => {
    const l = legal();
    expect(clampRaiseTo(l, '450')).toBe('450');
    expect(clampRaiseTo(l, '100')).toBe('300');   // below min → min
    expect(clampRaiseTo(l, '9999')).toBe('1700'); // above max → max
    expect(clampRaiseTo(l, '300')).toBe('300');   // min anchor
    expect(clampRaiseTo(l, '1700')).toBe('1700'); // max anchor
  });

  it('returns "" (fail-closed) on a malformed amount', () => {
    const l = legal();
    expect(clampRaiseTo(l, '')).toBe('');
    expect(clampRaiseTo(l, '-5')).toBe('');
    expect(clampRaiseTo(l, '1.5')).toBe('');
    expect(clampRaiseTo(l, 'abc')).toBe('');
  });
});

describe('fmtBB (chips → big blinds, floored to 0.1, trailing .0 stripped)', () => {
  it('formats whole and fractional BB', () => {
    expect(fmtBB('150', '50')).toBe('3');
    expect(fmtBB('75', '50')).toBe('1.5');
    expect(fmtBB('25', '50')).toBe('0.5');
    expect(fmtBB('1875', '50')).toBe('37.5');
    expect(fmtBB('980', '50')).toBe('19.6');
    expect(fmtBB('1700', '50')).toBe('34');
    expect(fmtBB('0', '50')).toBe('0');
  });

  it('returns "" on a zero/invalid bb or malformed chips', () => {
    expect(fmtBB('150', '0')).toBe('');
    expect(fmtBB('150', 'x')).toBe('');
    expect(fmtBB('abc', '50')).toBe('');
    expect(fmtBB('1.5', '50')).toBe('');
  });
});
