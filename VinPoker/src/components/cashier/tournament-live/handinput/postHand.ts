// P2-4 — post-hand felt refresh.
//
// After a hand is recorded, the racetrack should immediately show the correct
// post-settlement state: the busted player's seat disappears and each survivor's
// stack reflects its ending stack — WITHOUT the operator manually re-selecting the
// table.
//
// Elimination authority is the DB: `record_hand` sets `tournament_seats.is_active`
// = false when a player's `ending_stack` is 0 (the client sends `is_eliminated`),
// and the post-submit re-query returns only `is_active = true` seats →
// `activeSeatNumbers`. The ending stacks come from the `endingStacks` the operator
// just confirmed — identical to what `record_hand` persisted to
// `tournament_chip_counts` — so survivors show their new chips right away.

/** The minimal felt-player shape this transform touches (PlayerState satisfies it). */
export interface FeltSeat {
  player_id: string;
  seat_number: number;
  starting_stack: number;
  current_stack: number;
  current_bet: number;
  total_bet: number;
  is_folded: boolean;
  is_all_in: boolean;
}

/**
 * Keep only still-active seats (busted players drop off), set each survivor's
 * stack to its ending stack, and clear the per-hand flags for the next hand.
 * Pure — no DB, no side effects.
 */
export function survivorsAfterHand<T extends FeltSeat>(
  players: T[],
  activeSeatNumbers: number[],
  endingStacks: Record<string, number>,
): T[] {
  const active = new Set(activeSeatNumbers);
  return players
    .filter((p) => active.has(p.seat_number))
    .map((p) => {
      const end = endingStacks[p.player_id] ?? p.current_stack;
      return {
        ...p,
        starting_stack: end,
        current_stack: end,
        current_bet: 0,
        total_bet: 0,
        is_folded: false,
        is_all_in: false,
      };
    });
}

/**
 * BUGFIX (side_pots mismatch): clear every per-hand betting field on hand reset so a
 * voided/abandoned hand can never leak `total_bet`/`is_folded` into the next hand —
 * stale totals inflated the client's submitted side_pots while the server recomputes
 * from the fresh action stream ("side_pots không khớp với chuỗi hành động").
 *
 * `restoreStacks` is EXPLICIT and true ONLY for the void path: the server restores
 * every chip to the pre-hand state on void, so the felt mirrors it. On any other
 * reset (settled hand, new hand, table switch) stacks must NOT be touched — a
 * restore there would falsely "refund" chips a settled hand legitimately moved.
 * Pure — no DB, no side effects.
 */
export function clearBettingState<T extends FeltSeat>(players: T[], restoreStacks: boolean): T[] {
  return players.map((p) => ({
    ...p,
    current_bet: 0,
    total_bet: 0,
    is_folded: false,
    is_all_in: false,
    ...(restoreStacks ? { current_stack: p.starting_stack } : {}),
  }));
}
