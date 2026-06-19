// tests/onlinePoker/immersive.test.ts
// P0 mobile table mode — the immersive preference persists, and the best-effort fullscreen
// helpers never throw even where the Fullscreen API is unavailable (jsdom / iOS Safari).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  IMMERSIVE_KEY, readImmersivePref, writeImmersivePref,
  requestFullscreenBestEffort, exitFullscreenBestEffort, isFullscreenActive,
} from '@/lib/onlinePoker/immersive';

beforeEach(() => { try { localStorage.removeItem(IMMERSIVE_KEY); } catch { /* ignore */ } });

describe('immersive preference (localStorage)', () => {
  it('defaults off, round-trips on/off', () => {
    expect(readImmersivePref()).toBe(false);
    writeImmersivePref(true);
    expect(readImmersivePref()).toBe(true);
    writeImmersivePref(false);
    expect(readImmersivePref()).toBe(false);
  });
});

describe('best-effort fullscreen — never throws where unavailable', () => {
  it('request/exit/isActive are safe no-ops in jsdom', () => {
    expect(() => requestFullscreenBestEffort(null)).not.toThrow();
    expect(() => requestFullscreenBestEffort(document.createElement('div'))).not.toThrow();
    expect(() => exitFullscreenBestEffort()).not.toThrow();
    expect(typeof isFullscreenActive()).toBe('boolean');
  });
});
