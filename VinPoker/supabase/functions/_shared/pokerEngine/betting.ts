// supabase/functions/_shared/pokerEngine/betting.ts
// Pure betting logic: turn order, legal actions, action application, min-raise,
// and the sub-minimum all-in "no-reopen" rule. NO street advance / showdown here
// (those live in hand.ts) — this module never imports hand/pots/showdown, so the
// engine module graph stays acyclic.

import type { Action, HandEvent, HandState, LegalActions, SeatState } from './types.ts';
import { actionEvent } from './events.ts';

const bmax = (a: bigint, b: bigint) => (a > b ? a : b);
const bmin = (a: bigint, b: bigint) => (a < b ? a : b);

// ── seat ordering ──────────────────────────────────────────────────────────

export function seatsInClockwiseOrder(seats: SeatState[]): SeatState[] {
  return [...seats].sort((a, b) => a.seat - b.seat);
}

/** First seat (clockwise) from `fromSeat` matching `pred`. includeFrom decides if fromSeat is tested. */
export function firstClockwiseFrom(
  seats: SeatState[],
  fromSeat: number,
  includeFrom: boolean,
  pred: (s: SeatState) => boolean,
): SeatState | null {
  const ordered = seatsInClockwiseOrder(seats);
  const idx = ordered.findIndex((s) => s.seat === fromSeat);
  if (idx < 0) return null;
  const start = includeFrom ? idx : idx + 1;
  for (let k = 0; k < ordered.length; k++) {
    const s = ordered[(start + k) % ordered.length];
    if (pred(s)) return s;
  }
  return null;
}

const isInHand = (s: SeatState) => s.status === 'active' || s.status === 'allin';
const canAct = (s: SeatState) => s.status === 'active';

// ── turn pointer ─────────────────────────────────────────────────────────────

/** Next seat that still needs to act after `actorSeat`, or null if the round is closed. */
export function nextActorAfter(state: HandState, actorSeat: number): number | null {
  const next = firstClockwiseFrom(
    state.seats,
    actorSeat,
    false,
    (s) => canAct(s) && !s.hasActedThisRound,
  );
  return next ? next.seat : null;
}

/** Who must act now (the maintained pointer). */
export function nextPlayerToAct(state: HandState): number | null {
  return state.toAct;
}

export function isBettingRoundComplete(state: HandState): boolean {
  return !state.seats.some((s) => canAct(s) && !s.hasActedThisRound);
}

// ── legal actions ────────────────────────────────────────────────────────────

const EMPTY_MENU = (seat: number): LegalActions => ({
  seat, types: [], toCall: 0n, canCheck: false, minRaiseTo: 0n, maxRaiseTo: 0n,
});

export function legalActions(state: HandState, seat: number): LegalActions {
  const s = state.seats.find((x) => x.seat === seat);
  if (!s || state.status !== 'betting' || state.toAct !== seat || s.status !== 'active') {
    return EMPTY_MENU(seat);
  }
  const toCall = bmax(0n, state.currentBet - s.committed);
  const canCheck = toCall === 0n;
  const types: LegalActions['types'] = [];

  if (canCheck) types.push('check');
  else {
    types.push('fold');
    if (s.stack > 0n) types.push('call');
  }

  // raise/bet only if the seat retains raise rights AND has chips beyond the call
  const maxRaiseTo = s.committed + s.stack;
  let minRaiseTo = 0n;
  const canAggress = s.canRaise && s.stack > toCall;
  if (canAggress) {
    minRaiseTo = state.currentBet === 0n
      ? state.config.bb                                   // first bet: min = big blind
      : state.currentBet + state.lastFullRaiseSize;       // raise: min = currentBet + last full raise
    if (maxRaiseTo >= minRaiseTo) {
      types.push(state.currentBet === 0n ? 'bet' : 'raise');
    } else {
      minRaiseTo = 0n; // can't make a FULL raise; only a short all-in is possible
    }
  }
  // all-in is offered when it is a legal aggressive shove (canAggress) OR merely a
  // call/under-call (stack <= toCall). A seat barred from reopening (canRaise false)
  // with chips beyond the call may NOT all-in-raise — only call/fold.
  const isAllInCall = s.stack > 0n && s.stack <= toCall;
  if (s.stack > 0n && (canAggress || isAllInCall)) types.push('allin');

  return {
    seat,
    types,
    toCall,
    canCheck,
    minRaiseTo: types.includes('bet') || types.includes('raise') ? minRaiseTo : 0n,
    maxRaiseTo: types.includes('bet') || types.includes('raise') ? maxRaiseTo : 0n,
  };
}

/** Returns an error string if the action is illegal, or null if it is legal. */
export function validateAction(state: HandState, action: Action): string | null {
  if (state.status !== 'betting') return 'hand is not in a betting round';
  if (state.toAct !== action.seat) return 'not your turn';
  const s = state.seats.find((x) => x.seat === action.seat);
  if (!s || s.status !== 'active') return 'seat cannot act';

  const la = legalActions(state, action.seat);
  if (!la.types.includes(action.type)) return `action not legal: ${action.type}`;

  if (action.type === 'bet' || action.type === 'raise') {
    if (action.amount === undefined) return `${action.type} requires an amount`;
    if (action.amount < la.minRaiseTo || action.amount > la.maxRaiseTo) {
      return `illegal ${action.type} size: ${action.amount} (legal ${la.minRaiseTo}..${la.maxRaiseTo})`;
    }
  }
  return null;
}

// ── apply (chip movement + reopen rules) ─────────────────────────────────────

function moveToPot(state: HandState, s: SeatState, amount: bigint): void {
  if (amount < 0n) throw new Error('moveToPot: negative amount');
  s.stack -= amount;
  s.committed += amount;
  s.totalCommitted += amount;
  state.pot += amount;
  if (s.stack === 0n && s.status === 'active') s.status = 'allin';
}

/**
 * Apply an aggression (bet/raise/raising all-in). `incr` is the increase over the
 * prior currentBet. A FULL raise (incr >= lastFullRaiseSize) reopens the betting
 * for everyone; a SHORT all-in does NOT reopen for seats that already acted.
 */
function applyAggression(state: HandState, actor: SeatState, newCurrentBet: bigint, incr: bigint, isFull: boolean): void {
  state.currentBet = newCurrentBet;
  state.aggressor = actor.seat;
  if (isFull) {
    state.lastFullRaiseSize = incr;
    for (const t of state.seats) {
      if (t.seat !== actor.seat && t.status === 'active') {
        t.hasActedThisRound = false;
        t.canRaise = true;
      }
    }
  } else {
    for (const t of state.seats) {
      if (t.seat !== actor.seat && t.status === 'active' && t.hasActedThisRound) {
        // already acted: must respond to the extra, but may NOT re-raise (no-reopen rule)
        t.hasActedThisRound = false;
        t.canRaise = false;
      }
      // not-yet-acted seats keep full rights (unchanged)
    }
  }
}

/** Mutates `state` in place to apply a VALIDATED action. Does NOT advance the street. */
export function applyBettingAction(state: HandState, action: Action): HandEvent[] {
  const s = state.seats.find((x) => x.seat === action.seat)!;

  switch (action.type) {
    case 'fold': {
      s.status = 'folded';
      s.hasActedThisRound = true;
      return [actionEvent(s.seat, 'fold', 0n, state.pot)];
    }
    case 'check': {
      s.hasActedThisRound = true;
      return [actionEvent(s.seat, 'check', 0n, state.pot)];
    }
    case 'call': {
      const toCall = bmax(0n, state.currentBet - s.committed);
      const amt = bmin(toCall, s.stack);
      moveToPot(state, s, amt);
      s.hasActedThisRound = true;
      return [actionEvent(s.seat, 'call', amt, state.pot)];
    }
    case 'bet': {
      const target = action.amount!;
      const delta = target - s.committed;
      moveToPot(state, s, delta);
      s.hasActedThisRound = true;
      applyAggression(state, s, target, target /* incr over 0 */, true);
      return [actionEvent(s.seat, 'bet', delta, state.pot)];
    }
    case 'raise': {
      const target = action.amount!;
      const delta = target - s.committed;
      const incr = target - state.currentBet;
      moveToPot(state, s, delta);
      s.hasActedThisRound = true;
      applyAggression(state, s, target, incr, true);
      return [actionEvent(s.seat, 'raise', delta, state.pot)];
    }
    case 'allin': {
      const delta = s.stack;
      const target = s.committed + s.stack;
      moveToPot(state, s, delta); // stack -> 0, status -> allin
      s.hasActedThisRound = true;
      if (target > state.currentBet) {
        const incr = target - state.currentBet;
        const isFull = incr >= state.lastFullRaiseSize;
        applyAggression(state, s, target, incr, isFull);
      }
      // else: all-in call / under-call — currentBet unchanged, no reopen
      return [actionEvent(s.seat, 'allin', delta, state.pot)];
    }
    default:
      throw new Error(`unknown action ${(action as Action).type}`);
  }
}
