// Pure adapters that map the operator console's local hand state onto the SHARED
// LiveFelt props. LiveFelt also renders the public /live viewer + replay, so it
// must stay byte-identical for them — these adapters only feed the additive
// operator-only props (`onSeatClick` / `selectedSeat` are wired in the shell).
//
// PURE: no React, no Supabase. Unit-testable.

import type { SeatInfo, ActionLog } from "../LiveFelt";

/** Minimal slice of HandInputPanel's PlayerState the felt needs. */
export interface FeltPlayer {
  player_id: string;
  display_name: string;
  seat_number: number;
  current_stack: number;
  current_bet: number;
  is_folded: boolean;
  is_all_in: boolean;
  avatar_url?: string | null;
}

/** Minimal slice of the local ActionRecord (note: `amount`, not `action_amount`). */
export interface FeltAction {
  street: string;
  player_id: string;
  display_name: string;
  seat_number: number;
  action_type: string;
  amount: number;
  action_order: number;
}

/**
 * Map dealt-in players → LiveFelt SeatInfo. All seats are `is_active: true`
 * (dealt-in for this hand); folded/all-in/current_bet drive the felt's seat
 * styling and chip badges. position comes from the button-derived seat map.
 */
export function playersToSeatInfo(
  players: FeltPlayer[],
  opts: { tableId: string; positionsBySeat: Map<number, string> }
): SeatInfo[] {
  return players.map((p) => ({
    player_id: p.player_id,
    display_name: p.display_name,
    seat_number: p.seat_number,
    chip_count: p.current_stack,
    is_active: true,
    table_id: opts.tableId || null,
    position: opts.positionsBySeat.get(p.seat_number) ?? "",
    avatar_url: p.avatar_url ?? null,
    is_folded: p.is_folded,
    is_all_in: p.is_all_in,
    current_bet: p.current_bet,
  }));
}

/** player_id of the most recently recorded action (felt highlights it). */
export function lastActorIdOf(actions: FeltAction[]): string | null {
  return actions.length ? actions[actions.length - 1].player_id : null;
}

/** Latest action as a LiveFelt ActionLog (renames local `amount` → action_amount). */
export function latestActionLogOf(actions: FeltAction[]): ActionLog | null {
  if (!actions.length) return null;
  const a = actions[actions.length - 1];
  return {
    street: a.street,
    player_id: a.player_id,
    display_name: a.display_name,
    seat_number: a.seat_number,
    action_type: a.action_type,
    action_amount: a.amount,
    action_order: a.action_order,
  };
}

/** Seat number of a selected actor id (for LiveFelt `selectedSeat`), or null. */
export function selectedSeatOf(
  players: FeltPlayer[],
  selectedActorId: string | null
): number | null {
  if (!selectedActorId) return null;
  return players.find((p) => p.player_id === selectedActorId)?.seat_number ?? null;
}
