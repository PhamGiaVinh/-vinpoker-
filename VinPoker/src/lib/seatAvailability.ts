// Pure seat-availability helpers for the floor queue / auto-draw preview.
// Capacity-only preview (owner decision 2026-06-13): the preview never predicts
// WHICH seat a player gets — exact seats are drawn server-side at commit by
// confirm_registration_and_assign_seat. These helpers only mirror the RPC's
// table-eligibility filter (status='active' AND table_id IS NOT NULL AND
// active_count < max_seats) so the warning matches what the server will do.

export interface TournamentTableRow {
  id: string;
  table_name: string | null;
  table_number: number | null;
  max_seats: number | null;
  status: string | null;
  /** game_tables.id — NULL rows are ineligible for the draw (RPC filter). */
  table_id: string | null;
}

export interface ActiveSeatRow {
  table_id: string; // tournament_tables.id
  is_active: boolean;
}

export interface AvailabilityTable {
  tournamentTableId: string;
  tableName: string;
  tableNumber: number | null;
  maxSeats: number;
  activeCount: number;
  freeSeats: number;
}

export interface CapacityCheck {
  totalFree: number;
  waitingCount: number;
  ok: boolean;
  /** How many waiting players would NOT get a seat (0 when ok). */
  shortBy: number;
}

const DEFAULT_MAX_SEATS = 9; // matches tournament_tables.max_seats DEFAULT

export function computeAvailability(
  tables: TournamentTableRow[],
  seats: ActiveSeatRow[],
): AvailabilityTable[] {
  const activeCount: Record<string, number> = {};
  for (const s of seats) {
    if (!s.is_active) continue;
    activeCount[s.table_id] = (activeCount[s.table_id] ?? 0) + 1;
  }
  return tables
    .filter((t) => t.status === "active" && t.table_id !== null)
    .map((t) => {
      const max = t.max_seats ?? DEFAULT_MAX_SEATS;
      const count = activeCount[t.id] ?? 0;
      return {
        tournamentTableId: t.id,
        tableName: t.table_name ?? (t.table_number != null ? `Bàn ${t.table_number}` : "Bàn ?"),
        tableNumber: t.table_number,
        maxSeats: max,
        activeCount: count,
        freeSeats: Math.max(0, max - count),
      };
    })
    .sort((a, b) => (a.tableNumber ?? 1e9) - (b.tableNumber ?? 1e9));
}

export function capacityCheck(
  waitingCount: number,
  availability: AvailabilityTable[],
): CapacityCheck {
  const totalFree = availability.reduce((s, t) => s + t.freeSeats, 0);
  return {
    totalFree,
    waitingCount,
    ok: totalFree >= waitingCount,
    shortBy: Math.max(0, waitingCount - totalFree),
  };
}
