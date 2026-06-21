// supabase/functions/_shared/pokerEngine/button.ts
// TDA forward-moving ("dead") button placement for tournament play.
//
// Tournaments use a forward-moving button: the BIG BLIND always advances to the
// next live player (it is never dead/skipped); the small blind + button are then
// placed by PHYSICAL position relative to the BB — either can land on an EMPTY
// (busted) seat, producing a DEAD small blind and/or a DEAD button.
//
// This is a PURE, ADDITIVE helper: it computes the next hand's button/SB/BB from
// the physical ring (1..maxSeats) + the set of OCCUPIED (live) seats, BB-anchored
// on `prevBbSeat` (the seat that posted the previous hand's big blind). The engine
// stays the authority — createHand consumes the result via HandConfig.blindPlacement
// (and honours a DEAD SB by posting only the BB). Nothing changes for a hand that
// does not carry a placement (cash play keeps the legacy next-occupied advance).
//
// Source parity: this mirrors the tracker-side `nextButtonTournament`
// (src/lib/tournament/deadButton.ts) so the operator-assist suggestion and the
// authoritative server agree seat-for-seat. The DB-1 bust matrix is re-tested here
// against the engine (tests/pokerEngine/deadButton.test.ts).

import type { TournamentBlindPlacement } from './types.ts';

export interface DeadButtonInput {
  /** Physical seat capacity of the table (tournament_tables.max_seats, 2..10). */
  maxSeats: number;
  /** Seats with a live player this hand. */
  occupiedSeats: number[];
  /** The seat that posted the PREVIOUS hand's big blind (null on the first hand). */
  prevBbSeat: number | null;
}

/** Occupied seats within the physical ring, de-duplicated and sorted. */
function liveRing(maxSeats: number, occupiedSeats: number[]): number[] {
  return [...new Set(occupiedSeats)]
    .filter((s) => Number.isInteger(s) && s >= 1 && s <= maxSeats)
    .sort((a, b) => a - b);
}

/** The previous PHYSICAL seat on the ring 1..maxSeats (wraps 1 -> maxSeats). */
function ringPrev(seat: number, maxSeats: number): number {
  return seat <= 1 ? maxSeats : seat - 1;
}

/** First OCCUPIED seat strictly clockwise after `fromSeat` (by physical position, wrapping). */
function nextOccupiedAfter(fromSeat: number, occupied: number[], maxSeats: number): number | null {
  if (occupied.length === 0) return null;
  const set = new Set(occupied);
  for (let i = 1; i <= maxSeats; i++) {
    const seat = ((fromSeat - 1 + i) % maxSeats) + 1; // step clockwise on the ring
    if (set.has(seat)) return seat;
  }
  return null;
}

/**
 * Suggest the next hand's button / SB / BB per the TDA forward-moving (dead) button
 * rule. Returns `null` when it cannot place blinds (fewer than 2 live players, or the
 * first hand with no `prevBbSeat`) — the caller then sets the button some other way
 * (operator pick on the tracker side; explicit config on the server side).
 */
export function nextButtonTournament(
  { maxSeats, occupiedSeats, prevBbSeat }: DeadButtonInput,
): TournamentBlindPlacement | null {
  const occupied = liveRing(maxSeats, occupiedSeats);
  if (occupied.length < 2) return null;
  if (prevBbSeat == null) return null; // first hand -> caller sets the button

  // Heads-up: button = SB, acts first preflop; the blinds simply swap each hand.
  // Next BB = the live player who was NOT the BB last hand; that player's opponent
  // (the previous BB) takes the button/SB.
  if (occupied.length === 2) {
    const other = occupied.find((s) => s !== prevBbSeat);
    if (other == null) return null; // prevBb not among the two live seats -> can't anchor
    return { buttonSeat: prevBbSeat, sbSeat: prevBbSeat, bbSeat: other, deadButton: false, deadSb: false };
  }

  // 3+ handed: BB advances to the next live seat after the previous BB (never dead).
  const bbSeat = nextOccupiedAfter(prevBbSeat, occupied, maxSeats);
  if (bbSeat == null) return null;

  // SB = one physical seat before the BB; button = one physical seat before the SB
  // position. Either physical seat may be empty (dead).
  const sbPos = ringPrev(bbSeat, maxSeats);
  const buttonPos = ringPrev(sbPos, maxSeats);
  const occSet = new Set(occupied);

  return {
    buttonSeat: buttonPos,
    sbSeat: occSet.has(sbPos) ? sbPos : null,
    bbSeat,
    deadButton: !occSet.has(buttonPos),
    deadSb: !occSet.has(sbPos),
  };
}
