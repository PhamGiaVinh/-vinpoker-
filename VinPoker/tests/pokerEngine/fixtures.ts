// tests/pokerEngine/fixtures.ts
// Shared test helpers for the pure poker engine. Imported via the vitest-only
// @engine alias (see vitest.config.ts).

import { createHand, applyAction } from '@engine/index.ts';
import type {
  Action, ApplyResult, Card, HandEvent, HandState, SeatInput, SeatState, Rng32,
} from '@engine/index.ts';

/** Deterministic RNG for reproducible test shuffles. */
export function mulberry32(seed: number): Rng32 {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** SeatInput[] from a list of stacks, seats numbered 1..n. */
export function si(stacks: bigint[], playerPrefix = 'u'): SeatInput[] {
  return stacks.map((stack, i) => ({ seat: i + 1, playerId: `${playerPrefix}${i + 1}`, stack }));
}

export interface FreshOpts {
  button?: number;
  sb?: bigint;
  bb?: bigint;
  deck?: Card[];
}

import { makeDeck, shuffle } from '@engine/index.ts';

export function freshHand(stacks: bigint[], opts: FreshOpts = {}): HandState {
  const deck = opts.deck ?? makeDeck();
  const r = createHand(
    {
      handId: 'h1',
      tableId: 't1',
      handNo: 1,
      buttonSeat: opts.button ?? 1,
      sb: opts.sb ?? 50n,
      bb: opts.bb ?? 100n,
    },
    deck,
    si(stacks),
  );
  return r.state;
}

export const sumStacks = (s: HandState): bigint => s.seats.reduce((a, x) => a + x.stack, 0n);
/** The conserved quantity: Σ(stacks) + pot. NEVER add `committed` (double-count). */
export const totalChips = (s: HandState): bigint => sumStacks(s) + s.pot;

/** Apply a sequence of actions; throws if any is rejected. */
export function play(state: HandState, actions: Action[]): ApplyResult {
  let st = state;
  const events: HandEvent[] = [];
  for (const a of actions) {
    const r = applyAction(st, a);
    if (r.error) throw new Error(`action ${JSON.stringify(a)} rejected: ${r.error}`);
    st = r.state;
    events.push(...r.events);
  }
  return { state: st, events };
}

// ── low-level state builder for precise showdown / side-pot tests ────────────

export function baseSeat(over: Partial<SeatState> & { seat: number }): SeatState {
  return {
    seat: over.seat,
    playerId: over.playerId ?? `u${over.seat}`,
    startingStack: over.startingStack ?? 0n,
    stack: over.stack ?? 0n,
    committed: over.committed ?? 0n,
    totalCommitted: over.totalCommitted ?? 0n,
    status: over.status ?? 'active',
    hasActedThisRound: over.hasActedThisRound ?? false,
    canRaise: over.canRaise ?? true,
    holeCards: over.holeCards ?? [],
    revealedCards: over.revealedCards,
  };
}

export function makeState(over: Partial<HandState> & { seats: SeatState[] }): HandState {
  const pot = over.pot ?? over.seats.reduce((a, s) => a + s.totalCommitted, 0n);
  return {
    config: over.config ?? { handId: 'h1', tableId: 't1', handNo: 1, buttonSeat: over.buttonSeat ?? 1, sb: 50n, bb: 100n, schemaVersion: 1 },
    street: over.street ?? 'river',
    board: over.board ?? [],
    seats: over.seats,
    buttonSeat: over.buttonSeat ?? 1,
    toAct: over.toAct ?? null,
    currentBet: over.currentBet ?? 0n,
    lastFullRaiseSize: over.lastFullRaiseSize ?? 100n,
    aggressor: over.aggressor ?? null,
    pot,
    sidePots: over.sidePots ?? [],
    status: over.status ?? 'betting',
    result: over.result,
    deck: over.deck ?? [],
  };
}
