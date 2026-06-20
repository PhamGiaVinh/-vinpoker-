// tests/onlinePoker/feltSkin.test.ts
// UI-4 — the optional felt-skin preference defaults to the identity emerald felt and
// round-trips through localStorage; unknown/legacy values fall back to emerald.
import { describe, it, expect, beforeEach } from 'vitest';
import { FELT_SKIN_KEY, readFeltSkin, writeFeltSkin } from '@/lib/onlinePoker/feltSkin';

beforeEach(() => { try { localStorage.removeItem(FELT_SKIN_KEY); } catch { /* ignore */ } });

describe('felt skin preference', () => {
  it('defaults to emerald (preserves PokerVN identity)', () => {
    expect(readFeltSkin()).toBe('emerald');
  });

  it('round-trips premium <-> emerald', () => {
    writeFeltSkin('premium');
    expect(readFeltSkin()).toBe('premium');
    writeFeltSkin('emerald');
    expect(readFeltSkin()).toBe('emerald');
  });

  it('falls back to emerald for any non-premium stored value', () => {
    try { localStorage.setItem(FELT_SKIN_KEY, 'banana'); } catch { /* ignore */ }
    expect(readFeltSkin()).toBe('emerald');
  });
});
