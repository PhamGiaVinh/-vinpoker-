export const FLOOR_TABLE_CONTROL_MODES = ["manual", "tracker"] as const;

export type FloorTableControlMode = (typeof FLOOR_TABLE_CONTROL_MODES)[number];

export type FloorTableControlModeRow = {
  tt_id: string;
  table_id: string;
  floor_control_mode: FloorTableControlMode;
  floor_control_revision: number;
};

/**
 * Do not silently coerce an unknown database value to Manual.  Until the
 * controlled migration is applied, a write path must fail closed instead of
 * treating an unverified table as eligible for a non-zero-chip bust.
 */
export function parseFloorTableControlMode(value: unknown): FloorTableControlMode | null {
  return value === "manual" || value === "tracker" ? value : null;
}

export function parseFloorTableControlRevision(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  // PostgreSQL bigint values can be serialized as strings by the Supabase
  // client.  Accept only a canonical non-negative integer, then retain the
  // same safe-integer boundary as the numeric path.
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  return null;
}

/** Seats in older data can point at either tournament_tables.id or game_tables.id. */
export function findFloorTableControlRow<T extends FloorTableControlModeRow>(
  tables: readonly T[],
  seatTableId: string | null | undefined,
): T | null {
  if (!seatTableId) return null;
  const matches = tables.filter(
    (table) => table.tt_id === seatTableId || table.table_id === seatTableId,
  );

  // Older seats can use either identifier. If corrupt legacy data makes both
  // identifiers resolve to multiple active tables, choosing the first row would
  // let a client apply the wrong Manual/Tracker policy. The RPC has the same
  // exact-one rule, so every client preflight must fail closed as well.
  return matches.length === 1 ? matches[0] : null;
}
