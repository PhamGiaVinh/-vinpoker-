/**
 * Read-only client preflight for Floor actions that require a valid tournament entry.
 *
 * This never authorizes or mutates anything. The Floor RPC/Edge function remains
 * authoritative and repeats these checks under its own locks. The preflight only
 * prevents an operator from opening a destructive confirmation for data we already
 * know is unsafe.
 */
export type FloorSeatEntrySnapshot = {
  id: string;
  entry_id: string | null;
  is_active: boolean;
};

export type FloorSeatEntryPreflight =
  | { ok: true; entryId: string }
  | { ok: false; error: "seat_not_found" | "seat_not_active" | "orphan_active_seat" };

export function preflightFloorSeatEntry(
  seat: FloorSeatEntrySnapshot | null | undefined,
): FloorSeatEntryPreflight {
  if (!seat) return { ok: false, error: "seat_not_found" };
  if (!seat.is_active) return { ok: false, error: "seat_not_active" };
  if (!seat.entry_id) return { ok: false, error: "orphan_active_seat" };
  return { ok: true, entryId: seat.entry_id };
}

export type FloorTableEntryPreflight =
  | { ok: true }
  | {
    ok: false;
    error: "seat_not_found" | "seat_not_active" | "orphan_active_seat";
    blockedSeatCount: number;
  };

/**
 * Every active seat rendered in the table must be represented by one current,
 * active, entry-linked row before a client even asks the server to close it.
 */
export function preflightFloorTableEntries(
  expectedSeatIds: readonly string[],
  rows: readonly FloorSeatEntrySnapshot[],
): FloorTableEntryPreflight {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let firstError: Exclude<FloorSeatEntryPreflight, { ok: true }>['error'] | null = null;
  let blockedSeatCount = 0;

  for (const seatId of expectedSeatIds) {
    const result = preflightFloorSeatEntry(byId.get(seatId));
    if (!result.ok) {
      firstError ??= result.error;
      blockedSeatCount += 1;
    }
  }

  return firstError
    ? { ok: false, error: firstError, blockedSeatCount }
    : { ok: true };
}
