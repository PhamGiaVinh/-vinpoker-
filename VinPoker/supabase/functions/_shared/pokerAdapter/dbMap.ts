// supabase/functions/_shared/pokerAdapter/dbMap.ts
//
// GE-2C — pure maps between DB row shapes (online_poker_* tables) and engine
// inputs/outputs. No DB access. Chips cross the boundary as decimal strings and
// are parsed strictly via parseChip; stacks are read as TEXT from SQL to avoid
// the supabase-js bigint->number precision loss past 2^53.

import type { Action, HandConfig, HandEvent, SeatInput } from '../pokerEngine/types.ts';
import { chipToString, parseChip, envelopeEvents, SCHEMA_VERSION } from '../pokerEngine/index.ts';
import type { GameEventEnvelope } from '../pokerEngine/index.ts';

/**
 * Engine build tag persisted to online_poker_hands.engine_version for replay
 * pinning. SCHEMA_VERSION (the HandState JSON shape) maps to state_schema_version
 * separately; this is the engine BUILD identity.
 */
export const ENGINE_VERSION = 'ge-1.6';

/** online_poker_seats row. `stack` arrives as TEXT (chip string) from SQL. */
export interface SeatRow {
  seat_no: number;
  user_id: string | null;
  stack: string | number | bigint;
  status: 'empty' | 'sitting' | 'sitting_out';
}

/** Seated rows -> engine SeatInput[] (empty seats dropped). */
export function buildSeatInputs(rows: SeatRow[]): SeatInput[] {
  return rows
    .filter((r) => r.user_id !== null && (r.status === 'sitting' || r.status === 'sitting_out'))
    .map((r) => ({
      seat: r.seat_no,
      playerId: r.user_id as string,
      stack: toBigint(r.stack),
      sittingOut: r.status === 'sitting_out',
    }));
}

export interface TableRow {
  id: string;
  sb: string | number | bigint;
  bb: string | number | bigint;
}

/** online_poker_tables row + caller-chosen ids -> engine HandConfig. */
export function buildHandConfig(
  table: TableRow,
  handId: string,
  handNo: number,
  buttonSeat: number,
): HandConfig {
  return {
    handId,
    tableId: table.id,
    handNo,
    buttonSeat,
    sb: toBigint(table.sb),
    bb: toBigint(table.bb),
    schemaVersion: SCHEMA_VERSION,
  };
}

/** engine Action -> online_poker_actions.action jsonb (chip amount as string). */
export function actionToRow(a: Action): Record<string, unknown> {
  return a.amount !== undefined
    ? { type: a.type, seat: a.seat, amount: chipToString(a.amount) }
    : { type: a.type, seat: a.seat };
}

/** online_poker_actions.action jsonb -> engine Action (strict chip parse). */
export function actionFromRow(row: { type: Action['type']; seat: number; amount?: string | null }): Action {
  const a: Action = { type: row.type, seat: row.seat };
  if (row.amount !== undefined && row.amount !== null) a.amount = parseChip(row.amount);
  return a;
}

/** One online_poker_hand_events row. */
export interface HandEventRow {
  hand_id: string;
  event_seq: number;
  type: string;
  payload: Record<string, unknown>;
}

/** engine events -> online_poker_hand_events rows, seq continuing from startSeq. */
export function eventRows(handId: string, startSeq: number, events: HandEvent[]): HandEventRow[] {
  return envelopeEvents(handId, startSeq, events).map((e: GameEventEnvelope) => ({
    hand_id: e.handId,
    event_seq: e.seq,
    type: e.type,
    payload: e.payload,
  }));
}

function toBigint(v: string | number | bigint): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error(`unsafe chip number (read stacks as TEXT): ${v}`);
    return BigInt(v);
  }
  return parseChip(v);
}
