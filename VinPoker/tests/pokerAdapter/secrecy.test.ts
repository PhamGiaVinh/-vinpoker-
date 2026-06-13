// tests/pokerAdapter/secrecy.test.ts
// GE-2C adapter secrecy guardrails (owner-required checks 1-4): the stored public
// state and any projection must never carry the deck or a hidden hole card; the
// private view exposes ONLY the caller's own cards.

import { describe, it, expect } from 'vitest';
import {
  serializeAuthoritative, publicProjection, privateView,
} from '../../supabase/functions/_shared/pokerAdapter/index.ts';
import { freshHand } from '../pokerEngine/fixtures.ts';

describe('adapter secrecy boundary', () => {
  // Preflop: hole cards dealt, no board, no showdown reveals — so a hole card in
  // any public JSON would be a genuine leak (it cannot legitimately appear yet).
  const state = freshHand([1000n, 1000n, 1000n], { button: 1 });
  const allHoles = state.seats.flatMap((s) => s.holeCards);
  // A leaked card appears as a quoted JSON value ("Ac"); the bare 2-char form
  // collides with field names (e.g. "Ac" inside "hasActedThisRound"), so match
  // the quoted value, not the substring.
  const quoted = (card: string) => `"${card}"`;

  it('1. stored public state contains no "deck"', () => {
    const split = serializeAuthoritative(state);
    expect('deck' in (split.stateJson as unknown as Record<string, unknown>)).toBe(false);
    expect(JSON.stringify(split.stateJson)).not.toContain('deck');
    expect(split.liveDeck.length).toBeGreaterThan(0); // the deck lives in the SECRET split, not stateJson
  });

  it('2. stored public state contains no "holeCards" and no hole-card value', () => {
    const json = JSON.stringify(serializeAuthoritative(state).stateJson);
    expect(json).not.toContain('holeCards');
    for (const card of allHoles) expect(json).not.toContain(quoted(card));
  });

  it('3. publicProjection never exposes a hidden hole card', () => {
    const pub = publicProjection(state);
    for (const s of pub.seats) {
      expect((s as unknown as Record<string, unknown>).holeCards).toBeUndefined();
    }
    const json = JSON.stringify(pub);
    for (const card of allHoles) expect(json).not.toContain(quoted(card));
  });

  it('4. privateView exposes ONLY the caller seat’s cards', () => {
    const me = state.seats[0];
    const view = privateView(state, me.seat);
    expect(view.myHoleCards).toEqual(me.holeCards);
    // No seat object in the view carries holeCards.
    for (const s of view.seats) {
      expect((s as unknown as Record<string, unknown>).holeCards).toBeUndefined();
    }
    // Other seats' cards never appear anywhere in the private view.
    const others = state.seats.filter((s) => s.seat !== me.seat).flatMap((s) => s.holeCards);
    const json = JSON.stringify(view);
    for (const card of others) expect(json).not.toContain(quoted(card));
  });
});
