// tests/pokerEngine/lifecycle.test.ts
// Full-hand flows + the public/private secrecy boundary (guardrail 7).

import { describe, it, expect } from 'vitest';
import {
  applyAction, forcedTimeoutAction, makeDeck, shuffle,
  toPublicView, toPrivateView, serializeForTransport,
} from '@engine/index.ts';
import { freshHand, play, totalChips, mulberry32 } from './fixtures.ts';

describe('hand lifecycle', () => {
  it('fold-to-one ends the hand with NO reveal and conserves chips', () => {
    const st0 = freshHand([1000n, 1000n], { button: 1 });
    const initial = totalChips(st0);
    const r = applyAction(st0, { type: 'fold', seat: 1 }); // SB folds heads-up
    const st = r.state;
    expect(st.status).toBe('complete');
    expect(st.result?.endedBy).toBe('fold');
    expect(st.seats[1].stack).toBe(1050n); // BB wins SB's 50 (refund of own uncalled 50, then collects)
    expect(st.seats[0].stack).toBe(950n);
    expect(totalChips(st)).toBe(initial);
    expect(st.seats[0].revealedCards).toBeUndefined();
    expect(st.seats[1].revealedCards).toBeUndefined();
  });

  it('checks down to showdown and conserves chips', () => {
    const st0 = freshHand([1000n, 1000n], { button: 1, deck: makeDeck() });
    const initial = totalChips(st0);
    let st = play(st0, [{ type: 'call', seat: 1 }, { type: 'check', seat: 2 }]).state;
    expect(st.street).toBe('flop');
    expect(st.board.length).toBe(3);
    st = play(st, [{ type: 'check', seat: 2 }, { type: 'check', seat: 1 }]).state;
    expect(st.street).toBe('turn');
    st = play(st, [{ type: 'check', seat: 2 }, { type: 'check', seat: 1 }]).state;
    expect(st.street).toBe('river');
    st = play(st, [{ type: 'check', seat: 2 }, { type: 'check', seat: 1 }]).state;
    expect(st.status).toBe('complete');
    expect(st.result?.endedBy).toBe('showdown');
    expect(st.board.length).toBe(5);
    expect(totalChips(st)).toBe(initial);
  });

  it('runs out the board when all-in pre-flop and conserves chips', () => {
    const st0 = freshHand([1000n, 1000n], { button: 1, deck: shuffle(makeDeck(), mulberry32(3)) });
    const initial = totalChips(st0);
    let st = play(st0, [{ type: 'allin', seat: 1 }]).state;
    st = play(st, [{ type: 'allin', seat: 2 }]).state; // call all-in
    expect(st.status).toBe('complete');
    expect(st.board.length).toBe(5);
    expect(totalChips(st)).toBe(initial);
  });

  it('fold-to-one closes street metadata like a normal round close (no stale committed)', () => {
    // UTG raises to 300, everyone folds: the uncalled 200 is refunded and the
    // completed state must NOT keep committed=300 (> totalCommitted) on any seat.
    const st0 = freshHand([1000n, 1000n, 1000n], { button: 1 });
    const st = play(st0, [
      { type: 'raise', seat: 1, amount: 300n },
      { type: 'fold', seat: 2 },
      { type: 'fold', seat: 3 },
    ]).state;
    expect(st.status).toBe('complete');
    expect(st.seats.every((s) => s.committed === 0n)).toBe(true);
    expect(st.seats.every((s) => s.committed <= s.totalCommitted)).toBe(true);
    expect(st.currentBet).toBe(0n);
    expect(st.aggressor).toBeNull();
    expect(st.seats[0].stack).toBe(1150n); // 1000 - 300 + 200 refund + 250 pot (SB 50 + BB 100 + own called 100)
  });

  it('forcedTimeoutAction folds when facing a bet, checks when free', () => {
    const st = freshHand([1000n, 1000n], { button: 1 });
    expect(forcedTimeoutAction(st, 1)).toEqual({ type: 'fold', seat: 1 });
    const st2 = play(st, [{ type: 'call', seat: 1 }]).state;
    expect(forcedTimeoutAction(st2, 2)).toEqual({ type: 'check', seat: 2 });
  });
});

describe('secrecy boundary (public vs private)', () => {
  // Match a card as a serialized JSON *value* ("Ac"), not a raw substring — otherwise
  // the camelCase key "hasActedThisRound" would false-match the card "Ac".
  const q = (c: string) => `"${c}"`;

  it('public view + events never leak any hole card pre-flop', () => {
    const st = freshHand([1000n, 1000n, 1000n], { button: 1, deck: shuffle(makeDeck(), mulberry32(11)) });
    const r = applyAction(st, { type: 'fold', seat: 1 });
    const allHole = st.seats.flatMap((s) => s.holeCards);
    expect(allHole.length).toBe(6);

    const pub = serializeForTransport(toPublicView(st));
    const events = serializeForTransport(r.events);
    for (const c of allHole) {
      expect(pub).not.toContain(q(c));
      expect(events).not.toContain(q(c));
    }
    // public seats carry no holeCards field at all
    expect(toPublicView(st).seats.every((s) => !('holeCards' in s))).toBe(true);
  });

  it('private view exposes only the requesting seat\'s hole cards', () => {
    const st = freshHand([1000n, 1000n, 1000n], { button: 1, deck: shuffle(makeDeck(), mulberry32(11)) });
    const view = toPrivateView(st, 1);
    expect(view.myHoleCards).toEqual(st.seats[0].holeCards);

    const serialized = serializeForTransport(view);
    for (const c of st.seats[0].holeCards) expect(serialized).toContain(q(c)); // own cards present
    for (const other of [...st.seats[1].holeCards, ...st.seats[2].holeCards]) {
      expect(serialized).not.toContain(q(other)); // others' cards absent
    }
  });
});
