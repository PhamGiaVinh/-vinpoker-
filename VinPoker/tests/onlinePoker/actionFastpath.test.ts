// tests/onlinePoker/actionFastpath.test.ts
// Mức C — action fast-path pure contracts. These pin the OWNER-mandated P0 fixes:
//   P0-1 high-water ordering (an older hand can NEVER be accepted after a newer one),
//   P0-2 handNo normalized via BigInt (never lexicographic: "10" must beat "9"),
//   P0-3 submit fallback (a response without `view` routes to the OLD refetch path).
// Plus the legal-menu keying (one edge fetch per turn-state) and the ping body shape
// (anti-drift vs the edge zod union).

import { describe, it, expect } from 'vitest';
import { isNewerHandSnap, legalFetchKey, classifySubmitResult } from '@/lib/onlinePoker/tableState';
import { bodyPing } from '@/lib/onlinePoker/client';

describe('isNewerHandSnap — high-water (handNo, stateVersion) guard', () => {
  it('first snapshot (no high-water yet) is accepted', () => {
    expect(isNewerHandSnap(null, { handNo: 1, stateVersion: 0 })).toBe(true);
  });

  it('same hand: version increment accepted; equal and lower dropped', () => {
    const cur = { handNo: 7, stateVersion: 4 };
    expect(isNewerHandSnap(cur, { handNo: 7, stateVersion: 5 })).toBe(true);
    expect(isNewerHandSnap(cur, { handNo: 7, stateVersion: 4 })).toBe(false);
    expect(isNewerHandSnap(cur, { handNo: 7, stateVersion: 3 })).toBe(false);
  });

  it('a NEW hand at version 0 beats the old hand at a high version', () => {
    expect(isNewerHandSnap({ handNo: 7, stateVersion: 99 }, { handNo: 8, stateVersion: 0 })).toBe(true);
  });

  it('a stale snapshot of a PRIOR hand arriving late is dropped (never resurrects)', () => {
    expect(isNewerHandSnap({ handNo: 8, stateVersion: 0 }, { handNo: 7, stateVersion: 99 })).toBe(false);
  });

  it('P0-2: string handNos compare numerically, never lexicographically', () => {
    // lexicographic "10" < "9" would wrongly drop the newer hand
    expect(isNewerHandSnap({ handNo: '9', stateVersion: 2 }, { handNo: '10', stateVersion: 0 })).toBe(true);
    expect(isNewerHandSnap({ handNo: '10', stateVersion: 0 }, { handNo: '9', stateVersion: 99 })).toBe(false);
    // mixed number/string forms stay consistent
    expect(isNewerHandSnap({ handNo: 9, stateVersion: 2 }, { handNo: '10', stateVersion: 0 })).toBe(true);
    expect(isNewerHandSnap({ handNo: '7', stateVersion: '4' }, { handNo: '7', stateVersion: '5' })).toBe(true);
  });

  it('bigint-sized handNos beyond Number.MAX_SAFE_INTEGER still order correctly', () => {
    expect(isNewerHandSnap(
      { handNo: '9007199254740993', stateVersion: 0 },
      { handNo: '9007199254740994', stateVersion: 0 },
    )).toBe(true);
    expect(isNewerHandSnap(
      { handNo: '9007199254740994', stateVersion: 0 },
      { handNo: '9007199254740993', stateVersion: 5 },
    )).toBe(false);
  });

  it('fail-closed: malformed handNo / stateVersion is dropped', () => {
    expect(isNewerHandSnap(null, { handNo: 'not-a-number', stateVersion: 0 })).toBe(false);
    expect(isNewerHandSnap(null, { handNo: 1, stateVersion: Number.NaN })).toBe(false);
  });
});

describe('legalFetchKey — one edge fetch per turn-state', () => {
  const view = (over: Partial<{ handId: string; status: string; toActSeat: number | null }> = {}) =>
    ({ handId: 'h1', status: 'betting', toActSeat: 3, ...over });

  it('my turn while betting → stable handId:stateVersion key', () => {
    expect(legalFetchKey(view(), 3, 12)).toBe('h1:12');
    expect(legalFetchKey(view(), 3, 12)).toBe('h1:12'); // identical polls → identical key (no refetch)
  });

  it('every action bumps state_version server-side → a re-opened turn makes a NEW key', () => {
    expect(legalFetchKey(view(), 3, 12)).not.toBe(legalFetchKey(view(), 3, 13));
  });

  it('off-turn / non-betting / spectator / missing version → null (menu cleared)', () => {
    expect(legalFetchKey(view({ toActSeat: 5 }), 3, 12)).toBeNull(); // opponent to act
    expect(legalFetchKey(view({ status: 'complete', toActSeat: null }), 3, 12)).toBeNull();
    expect(legalFetchKey(view(), null, 12)).toBeNull(); // spectator (no seat)
    expect(legalFetchKey(view(), 3, null)).toBeNull(); // no snapshot yet
    expect(legalFetchKey(null, 3, 12)).toBeNull(); // no hand
  });
});

describe('classifySubmitResult — P0-3 fallback contract', () => {
  it('ok:false → rejected (toast, no refetch)', () => {
    expect(classifySubmitResult({ ok: false, code: 'not_your_turn' })).toBe('rejected');
  });

  it('ok:true with view + stateVersion → fastpath (render the server view now)', () => {
    expect(classifySubmitResult({ ok: true, handId: 'h', stateVersion: 3, view: { config: {} } })).toBe('fastpath');
  });

  it('ok:true WITHOUT view (older deployed edge) → refetch — old behavior, never a dead-end', () => {
    expect(classifySubmitResult({ ok: true, handId: 'h' })).toBe('refetch');
    expect(classifySubmitResult({ ok: true, view: 'not-an-object', stateVersion: 1 })).toBe('refetch');
    expect(classifySubmitResult({ ok: true, view: { config: {} } })).toBe('refetch'); // missing stateVersion
  });

  it('garbage / null / undefined → refetch (fail-open to the safe path)', () => {
    expect(classifySubmitResult(null)).toBe('refetch');
    expect(classifySubmitResult(undefined)).toBe('refetch');
    expect(classifySubmitResult('boom')).toBe('refetch');
  });
});

describe('bodyPing — anti-drift vs the edge zod union', () => {
  it('is exactly {op:"ping"} (the edge discriminated union matches on this literal)', () => {
    expect(bodyPing()).toEqual({ op: 'ping' });
  });
});
