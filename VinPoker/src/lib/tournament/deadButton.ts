// P2-5 — TDA forward-moving ("dead") button SUGGESTION.
//
// Tournaments use a forward-moving button: the BIG BLIND always advances to the
// next live player (it is never dead/skipped), and the small blind + button are
// placed by PHYSICAL position relative to the BB — either can land on an empty
// (busted) seat, producing a DEAD small blind and/or a DEAD button.
//
// This is pure + SUGGESTION-only: the operator (who watches the real table) stays
// the authority and can override the button by tapping any seat. `nextButton`
// (lib/tournament/button.ts) keeps the simple next-occupied advance for the manual
// callers; this function is the engine's best-effort tournament-correct suggestion.
//
// It operates on the PHYSICAL ring `1..maxSeats` (from `tournament_tables.max_seats`)
// + the set of OCCUPIED (live) seats. It is BB-anchored on `prevBbSeat` (the seat
// that posted the previous hand's big blind).

export interface DeadButtonResult {
  /** The button seat — may be an EMPTY seat (dead button). */
  buttonSeat: number;
  /** The small-blind seat, or null when the SB position is empty (dead SB). */
  sbSeat: number | null;
  /** The big-blind seat — always an occupied/live seat. */
  bbSeat: number;
  deadButton: boolean;
  deadSb: boolean;
}

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

/** The previous PHYSICAL seat on the ring 1..maxSeats (wraps 1 → maxSeats). */
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
 * rule. Returns `null` when it cannot suggest (fewer than 2 live players, or the
 * first hand with no `prevBbSeat`) — the operator then sets the button manually.
 */
export function nextButtonTournament({ maxSeats, occupiedSeats, prevBbSeat }: DeadButtonInput): DeadButtonResult | null {
  const occupied = liveRing(maxSeats, occupiedSeats);
  if (occupied.length < 2) return null;
  if (prevBbSeat == null) return null; // first hand → operator sets the button

  // Heads-up: button = SB, acts first preflop; the blinds simply swap each hand.
  // Next BB = the live player who was NOT the BB last hand; that player's opponent
  // (the previous BB) takes the button/SB.
  if (occupied.length === 2) {
    const other = occupied.find((s) => s !== prevBbSeat);
    if (other == null) return null; // prevBb not among the two live seats → can't anchor
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
