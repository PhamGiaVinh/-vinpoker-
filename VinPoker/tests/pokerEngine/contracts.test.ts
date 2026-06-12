// tests/pokerEngine/contracts.test.ts
// Shared game-state contract: strict chip-string codec, wire views (secrecy by
// construction, bigint-free JSON), legal-action wire menu, error-code mapping,
// request->action conversion, and event enveloping.

import { describe, it, expect } from 'vitest';
import {
  applyAction, makeDeck, shuffle,
  chipToString, parseChip, actionFromRequest, classifyActionError, envelopeEvents,
  toWirePublicState, toWirePrivateState, toWireLegalActions,
} from '@engine/index.ts';
import type { ActionRequest, HandEvent } from '@engine/index.ts';
import { freshHand, mulberry32 } from './fixtures.ts';

// Match a card as a serialized JSON *value* ("Ac"), not a raw substring.
const q = (c: string) => `"${c}"`;

describe('chip string codec', () => {
  it('round-trips exactly, including values beyond Number.MAX_SAFE_INTEGER', () => {
    for (const v of [0n, 1n, 250n, 9007199254740993n, 123456789012345678901234567890n]) {
      expect(parseChip(chipToString(v))).toBe(v);
    }
  });

  it('rejects every non-canonical string', () => {
    for (const bad of ['', '-1', '1.5', '1e3', '007', ' 1', '1 ', '+1', 'abc', '0x10', '10n']) {
      expect(() => parseChip(bad)).toThrow(/invalid chip string/);
    }
  });
});

describe('wire state views', () => {
  it('public wire state is bigint-free JSON with chips as strings and NO hidden cards', () => {
    const st = freshHand([1000n, 1000n, 1000n], { button: 1, deck: shuffle(makeDeck(), mulberry32(11)) });
    const wire = toWirePublicState(st);

    // plain JSON.stringify must work — proves no bigint reaches the wire shape
    const json = JSON.stringify(wire);

    expect(typeof wire.pot).toBe('string');
    expect(typeof wire.currentBet).toBe('string');
    expect(typeof wire.config.bb).toBe('string');
    expect(wire.seats.every((s) => typeof s.stack === 'string')).toBe(true);
    expect(parseChip(wire.pot)).toBe(st.pot);
    expect(parseChip(wire.seats[0].stack)).toBe(st.seats[0].stack);

    // secrecy: no deck, no holeCards field, no hole-card value anywhere
    expect(json).not.toContain('"deck"');
    expect(json).not.toContain('"holeCards"');
    for (const c of st.seats.flatMap((s) => s.holeCards)) {
      expect(json).not.toContain(q(c));
    }
  });

  it('private wire state adds ONLY the requesting seat\'s own cards', () => {
    const st = freshHand([1000n, 1000n, 1000n], { button: 1, deck: shuffle(makeDeck(), mulberry32(11)) });
    const wire = toWirePrivateState(st, 2);
    expect(wire.mySeat).toBe(2);
    expect(wire.myHoleCards).toEqual(st.seats[1].holeCards);

    const json = JSON.stringify(wire);
    for (const own of st.seats[1].holeCards) expect(json).toContain(q(own));
    for (const other of [...st.seats[0].holeCards, ...st.seats[2].holeCards]) {
      expect(json).not.toContain(q(other));
    }
  });

  it('wire legal actions mirror the engine menu with chip strings', () => {
    const st = freshHand([1000n, 1000n], { button: 1 }); // heads-up: SB(button)=seat 1 to act
    const la = toWireLegalActions(st, 1);
    expect(la.seat).toBe(1);
    expect(la.types).toContain('call');
    expect(la.types).toContain('raise');
    expect(la.toCall).toBe('50');
    expect(la.minRaiseTo).toBe('200');   // currentBet 100 + last full raise 100
    expect(la.maxRaiseTo).toBe('1000');  // committed 50 + stack 950
    expect(la.canCheck).toBe(false);
    // non-actor gets an empty menu
    expect(toWireLegalActions(st, 2).types).toEqual([]);
  });
});

describe('classifyActionError', () => {
  it('maps real engine rejections to stable codes', () => {
    const hu = freshHand([1000n, 1000n], { button: 1 });

    const outOfTurn = applyAction(hu, { type: 'check', seat: 2 });
    expect(classifyActionError(outOfTurn.error!)).toBe('not_your_turn');

    const checkIntoBet = applyAction(hu, { type: 'check', seat: 1 });
    expect(classifyActionError(checkIntoBet.error!)).toBe('action_not_legal');

    const noAmount = applyAction(hu, { type: 'raise', seat: 1 });
    expect(classifyActionError(noAmount.error!)).toBe('amount_required');

    const tooBig = applyAction(hu, { type: 'raise', seat: 1, amount: 5000n });
    expect(classifyActionError(tooBig.error!)).toBe('illegal_amount');

    const done = applyAction(hu, { type: 'fold', seat: 1 }).state; // hand complete
    const afterComplete = applyAction(done, { type: 'check', seat: 2 });
    expect(classifyActionError(afterComplete.error!)).toBe('not_in_betting');
  });

  it('maps the remaining engine strings and unknowns', () => {
    expect(classifyActionError('seat cannot act')).toBe('seat_cannot_act');
    expect(classifyActionError('something else entirely')).toBe('unknown');
  });
});

describe('actionFromRequest', () => {
  const base: Omit<ActionRequest, 'type' | 'amount'> = {
    handId: 'h1', seat: 3, idempotencyKey: 'k-1',
  };

  it('converts intent with a strict-parsed amount', () => {
    expect(actionFromRequest({ ...base, type: 'raise', amount: '300' }))
      .toEqual({ type: 'raise', seat: 3, amount: 300n });
    expect(actionFromRequest({ ...base, type: 'fold' }))
      .toEqual({ type: 'fold', seat: 3 });
  });

  it('throws on a malformed amount (RPC maps it to bad_request)', () => {
    expect(() => actionFromRequest({ ...base, type: 'bet', amount: '3.5' }))
      .toThrow(/invalid chip string/);
    expect(() => actionFromRequest({ ...base, type: 'bet', amount: '-100' }))
      .toThrow(/invalid chip string/);
  });
});

describe('envelopeEvents', () => {
  it('stamps handId and consecutive persistence seqs', () => {
    const events: HandEvent[] = [
      { type: 'action', payload: { seat: 1, actionType: 'call' } },
      { type: 'street_advanced', payload: { street: 'flop' } },
    ];
    expect(envelopeEvents('h7', 5, events)).toEqual([
      { handId: 'h7', seq: 5, type: 'action', payload: { seat: 1, actionType: 'call' } },
      { handId: 'h7', seq: 6, type: 'street_advanced', payload: { street: 'flop' } },
    ]);
  });
});
