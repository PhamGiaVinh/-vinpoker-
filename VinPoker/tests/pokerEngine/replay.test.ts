// tests/pokerEngine/replay.test.ts
// Determinism + replay: (config, deck, seats, actions) must reproduce a hand
// bit-for-bit; applyAction must never mutate its input; a corrupt action log
// must be detected; checkInvariants must flag tampered states.

import { describe, it, expect } from 'vitest';
import {
  createHand, applyAction, legalActions, cloneState, makeDeck, shuffle,
  serializeForTransport, replayHand, ReplayError, checkInvariants,
} from '@engine/index.ts';
import type { Action, Card, HandEvent, HandState } from '@engine/index.ts';
import { freshHand, play, si, mulberry32 } from './fixtures.ts';

const CONFIG = { handId: 'h1', tableId: 't1', handNo: 1, buttonSeat: 1, sb: 50n, bb: 100n };

/** A scripted 3-handed multi-street line: raise, call, fold, bets, showdown. */
const SCRIPT_ACTIONS: Action[] = [
  { type: 'raise', seat: 1, amount: 300n },  // UTG raises
  { type: 'fold', seat: 2 },                 // SB folds
  { type: 'call', seat: 3 },                 // BB calls -> flop
  { type: 'check', seat: 3 },
  { type: 'bet', seat: 1, amount: 400n },
  { type: 'call', seat: 3 },                 // -> turn
  { type: 'check', seat: 3 },
  { type: 'check', seat: 1 },                // -> river
  { type: 'check', seat: 3 },
  { type: 'allin', seat: 1 },
  { type: 'call', seat: 3 },                 // -> showdown
];

describe('replayHand determinism', () => {
  it('replaying the same script twice yields identical state and events', () => {
    const deck = shuffle(makeDeck(), mulberry32(21));
    const script = { config: CONFIG, deck, seats: si([2000n, 2000n, 2000n]), actions: SCRIPT_ACTIONS };

    const a = replayHand(script);
    const b = replayHand(script);

    expect(a.state.status).toBe('complete');
    expect(serializeForTransport(b.state)).toBe(serializeForTransport(a.state));
    expect(serializeForTransport(b.events)).toBe(serializeForTransport(a.events));
  });

  it('replay reproduces a hand played live step-by-step', () => {
    const deck = shuffle(makeDeck(), mulberry32(21));
    const live0 = freshHand([2000n, 2000n, 2000n], { button: 1, deck });
    const live = play(live0, SCRIPT_ACTIONS).state;

    const replayed = replayHand({
      config: CONFIG, deck, seats: si([2000n, 2000n, 2000n]), actions: SCRIPT_ACTIONS,
    });

    expect(serializeForTransport(replayed.state)).toBe(serializeForTransport(live));
  });

  it('applyAction is pure: the input state is never mutated and a new object is returned', () => {
    const st = freshHand([1000n, 1000n, 1000n], { button: 1, deck: shuffle(makeDeck(), mulberry32(5)) });
    const before = serializeForTransport(st);
    const r = applyAction(st, { type: 'raise', seat: 1, amount: 300n });
    expect(r.error).toBeUndefined();
    expect(r.state).not.toBe(st);
    expect(serializeForTransport(st)).toBe(before);
  });
});

describe('random legal lines replay bit-for-bit', () => {
  /** Walk a hand with seeded pseudo-random legal actions; return the recording. */
  function randomWalk(deck: Card[], stacks: bigint[], choiceSeed: number) {
    const rng = mulberry32(choiceSeed);
    const created = createHand(CONFIG, deck, si(stacks));
    let st: HandState = created.state;
    const events: HandEvent[] = [...created.events];
    const actions: Action[] = [];

    let guard = 0;
    while (st.status === 'betting' && guard++ < 300) {
      const la = legalActions(st, st.toAct!);
      const type = la.types[rng() % la.types.length];
      const action: Action = { type, seat: la.seat };
      if (type === 'bet' || type === 'raise') {
        const choices = [la.minRaiseTo, la.maxRaiseTo, (la.minRaiseTo + la.maxRaiseTo) / 2n];
        action.amount = choices[rng() % 3];
      }
      const r = applyAction(st, action);
      expect(r.error).toBeUndefined();
      st = r.state;
      events.push(...r.events);
      actions.push(action);
    }
    expect(st.status).toBe('complete');
    return { state: st, events, actions };
  }

  it('25 seeded random hands all replay to the exact same state and events', () => {
    const stacks = [1000n, 400n, 2500n, 700n]; // uneven -> all-ins and side pots
    for (let seed = 1; seed <= 25; seed++) {
      const deck = shuffle(makeDeck(), mulberry32(seed));
      const live = randomWalk(deck, stacks, seed * 7 + 1);

      // replayHand also re-asserts every invariant at every step
      const replayed = replayHand({ config: CONFIG, deck, seats: si(stacks), actions: live.actions });

      expect(serializeForTransport(replayed.state)).toBe(serializeForTransport(live.state));
      expect(serializeForTransport(replayed.events)).toBe(serializeForTransport(live.events));
    }
  });
});

describe('replay corruption detection', () => {
  it('throws ReplayError (with the action index) when the log contains an illegal action', () => {
    const deck = shuffle(makeDeck(), mulberry32(21));
    const corrupt: Action[] = [...SCRIPT_ACTIONS, { type: 'check', seat: 3 }]; // act after complete
    let caught: unknown;
    try {
      replayHand({ config: CONFIG, deck, seats: si([2000n, 2000n, 2000n]), actions: corrupt });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ReplayError);
    expect((caught as ReplayError).actionIndex).toBe(SCRIPT_ACTIONS.length);
    expect((caught as ReplayError).reason).toContain('not in a betting round');
  });
});

describe('checkInvariants flags tampered states', () => {
  it('accepts a freshly dealt hand and rejects manual corruption', () => {
    const st = freshHand([1000n, 1000n, 1000n], { button: 1, deck: shuffle(makeDeck(), mulberry32(9)) });
    expect(checkInvariants(st, 3000n)).toEqual([]);

    const negStack = cloneState(st);
    negStack.seats[0].stack = -1n;
    expect(checkInvariants(negStack).join('\n')).toContain('negative stack');

    const dupCard = cloneState(st);
    dupCard.seats[0].holeCards = [...dupCard.seats[1].holeCards] as Card[];
    expect(checkInvariants(dupCard).join('\n')).toContain('duplicate card');

    const stolen = cloneState(st);
    stolen.pot += 100n; // chips out of thin air
    expect(checkInvariants(stolen, 3000n).join('\n')).toContain('chip conservation broken');
  });
});
