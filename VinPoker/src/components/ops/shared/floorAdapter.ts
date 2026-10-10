// floorAdapter — PURE mapping từ dữ liệu floor THẬT (tournament_tables + get_seats) sang
// shape MockTable/MockSeat mà RoomGrid/PlayerActionSheets đang nhận. Không React, không IO.
//
// P0-5 (review owner): status bàn phải GIỐNG HỆT desktop — tableStatus() + chuẩn hoá canonical
// table-id dưới đây được COPY NGUYÊN VĂN từ FloorTableMapPanel.tsx (không suy luận mới).
// Nếu desktop đổi logic, sửa ở đó rồi đồng bộ lại đây (kèm test).

import type { MockTable, MockSeat } from "@/components/ops/mock/opsData";
import type { MapSeat, MapTable } from "@/components/cashier/tournament-live/FloorTableDetailSheet";
import type { FloorTournamentInventoryItem } from "@/lib/floorTableControlV3";
import type { TournamentParticipation } from "@/lib/tournamentParticipation";

export type { MapSeat, MapTable };

/** Preserve real seat identities and fence reused physical tables by incarnation. */
export function buildCanonicalOperationalFloor(
  inventory: FloorTournamentInventoryItem[],
  participation: TournamentParticipation,
): { tables: MapTable[]; seatsByTable: Record<string, MapSeat[]>; repairWarnings: string[] } {
  const repairWarnings = inventory.filter((row) => row.availabilityStatus === "repair_required")
    .map((row) => `${row.tableName ?? `Bàn ${row.tableNumber ?? "?"}`}: cần sửa dữ liệu phiên bàn.`);
  const tables: MapTable[] = inventory
    .filter((row) => row.availabilityStatus === "current_tournament")
    .map((row) => {
      if (!row.tournamentTableId || !row.tableSessionId || !row.controlMode
        || row.revision === null || row.controlEpoch === null || row.maxSeats === null) {
        throw new Error("Không xác minh được phiên bàn hiện tại.");
      }
      return {
        tt_id: row.tournamentTableId, table_id: row.gameTableId,
        table_number: row.tableNumber,
        table_name: row.tableName ?? `Bàn ${row.tableNumber ?? "?"}`,
        max_seats: row.maxSeats, status: "active",
        floor_control_mode: row.controlMode, floor_control_revision: row.revision,
        table_session_id: row.tableSessionId, control_epoch: row.controlEpoch,
      };
    })
    .sort((a, b) => (a.table_number ?? 1e9) - (b.table_number ?? 1e9));
  const byLogical = new Map(tables.map((table) => [table.tt_id, table]));
  const seatsByTable: Record<string, MapSeat[]> = {};
  const seatIds = new Set<string>();
  const positions = new Set<string>();
  for (const seat of participation.seats) {
    const table = seat.tournament_table_id ? byLogical.get(seat.tournament_table_id) : undefined;
    const position = `${seat.table_session_id}:${seat.seat_number}`;
    if (!table || seat.table_session_id !== table.table_session_id
      || ![table.table_id, table.tt_id].includes(seat.table_id ?? "")) {
      repairWarnings.push(`${seat.player_name || seat.player_id}, ghế ${seat.seat_number}, ${seat.chip_count} chip: cần sửa liên kết phiên (${seat.anomaly_reason ?? "session_mismatch"}).`);
      continue;
    }
    if (!seat.seat_id || seatIds.has(seat.seat_id) || positions.has(position)
      || seat.seat_number < 1 || seat.seat_number > table.max_seats) {
      throw new Error("Cần sửa dữ liệu ghế/phiên bàn; không coi ghế có dữ liệu lỗi là ghế trống.");
    }
    seatIds.add(seat.seat_id);
    positions.add(position);
    if (seat.participation_status === "anomaly") repairWarnings.push(
      `${table.table_name}, ghế ${seat.seat_number}, ${seat.player_name || seat.player_id}: cần sửa dữ liệu (${seat.anomaly_reason}).`,
    );
    (seatsByTable[table.table_id] ??= []).push({
      ...seat, table_id: table.table_id, table_name: table.table_name,
      integrity_status: seat.entry_id && seat.participation_status === "seated" ? "valid" : "missing_entry",
    });
  }
  for (const seats of Object.values(seatsByTable)) seats.sort((a, b) => a.seat_number - b.seat_number);
  return { tables, seatsByTable, repairWarnings };
}

// ── COPY VERBATIM: FloorTableMapPanel.tsx tableStatus() ────────────────────────
// Status from data already loaded: closed (table broken/closed) → paused (room on
// break) → running (has active players) → open. Per-table pause needs a table-level
// field (deferred); break is room-wide via tournament.status === "break".
export function tableStatus(
  occupied: number,
  raw: string,
  onBreak: boolean
): MockTable["status"] {
  if (raw !== "active") return "closed";
  if (onBreak) return "paused";
  if (occupied > 0) return "running";
  return "open";
}

// ── COPY VERBATIM: FloorTableMapPanel.tsx load() normalization ─────────────────
// A seat's table_id may reference EITHER game_tables.id (older draw seats) OR
// tournament_tables.id (seats created by move_player_seat / manual inserts) —
// the live DB carries both conventions. Normalize every id to the table's
// canonical key (game_tables.id = tournament_tables.table_id) so occupancy
// shows regardless of which convention the seat used. Only is_active seats
// count; sorted by seat_number.
export function buildSeatsByTable(
  tables: MapTable[],
  seats: MapSeat[]
): Record<string, MapSeat[]> {
  const canonicalByAny: Record<string, string> = {};
  for (const t of tables) {
    if (t.table_id) {
      canonicalByAny[t.table_id] = t.table_id; // game_tables.id → itself
      canonicalByAny[t.tt_id] = t.table_id;    // tournament_tables.id → game_tables.id
    }
  }
  const grouped: Record<string, MapSeat[]> = {};
  for (const s of seats) {
    if (!s.is_active) continue;
    const key = canonicalByAny[s.table_id] ?? s.table_id;
    (grouped[key] ??= []).push(s);
  }
  for (const k of Object.keys(grouped)) grouped[k].sort((a, b) => a.seat_number - b.seat_number);
  return grouped;
}

/**
 * The mobile operational map is not an audit-history view. Closed/broken
 * tournament-table rows must stay in the database for receipts and history,
 * but they cannot be shown as selectable room tables after a successful close.
 *
 * A duplicate active number is a server-data invariant breach. Report it to
 * the caller instead of letting a number-keyed UI select an arbitrary table.
 */
export function buildOperationalFloorTables(tables: MapTable[]): {
  tables: MapTable[];
  duplicateActiveTableNumbers: number[];
} {
  const activeTables = tables.filter((table) => table.status === "active");
  const counts = new Map<number, number>();
  for (const table of activeTables) {
    if (table.table_number == null) continue;
    counts.set(table.table_number, (counts.get(table.table_number) ?? 0) + 1);
  }
  const duplicateActiveTableNumbers = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([tableNumber]) => tableNumber)
    .sort((a, b) => a - b);

  return { tables: activeTables, duplicateActiveTableNumbers };
}

/**
 * Destination candidates must match the server contract in move_player_seat and
 * restore_busted_player_to_seat: a table belongs to this tournament, is active,
 * has a linked game table, and has an actually free seat. Keeping closed or
 * unlinked tables out of the UI prevents a guaranteed invalid_destination_table.
 */
export function buildEligibleFloorMoveTargets(
  tables: MapTable[],
  seatsByTable: Record<string, MapSeat[]>,
): { tt_id: string; table_number: number | null; freeSeats: number[] }[] {
  return tables
    .filter((table) => table.status === "active" && Boolean(table.table_id))
    .map((table) => {
      const occupied = new Set(
        (seatsByTable[table.table_id] ?? [])
          .filter((seat) => seat.is_active)
          .map((seat) => seat.seat_number),
      );
      const maxSeats = table.max_seats ?? 9;
      const freeSeats = Array.from({ length: maxSeats }, (_, index) => index + 1)
        .filter((seatNumber) => !occupied.has(seatNumber));
      return { tt_id: table.tt_id, table_number: table.table_number, freeSeats };
    })
    .filter((table) => table.freeSeats.length > 0);
}

// ── Chip display (P1-3): phân biệt null/undefined ("—") với 0 ("0") ────────────
// CẤM dùng `chip_count || "—"` — 0 chip là dữ liệu thật, phải hiện "0".
export function chipDisplay(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("vi-VN");
}

// ── Adapters → mock shapes (shared components giữ nguyên, P1-5) ────────────────
/** tableNo phải unique để OpsTables tra ngược VM; bàn thiếu table_number dùng fallbackNo (>=1000). */
export function toMockTable(
  t: MapTable,
  occ: number,
  onBreak: boolean,
  fallbackNo: number
): MockTable {
  return {
    tableNo: t.table_number ?? fallbackNo,
    status: tableStatus(occ, t.status, onBreak),
    occ,
    max: t.max_seats ?? 9,
    dealer: null, // floor map thật không mang tên dealer — hiện "—" (dealer thuộc màn Dealer Swing)
  };
}

export function toMockSeat(s: MapSeat): MockSeat {
  return {
    seat: s.seat_number,
    name: s.player_name ?? null,
    chip: chipDisplay(s.chip_count),
    entryNo: s.entry_number,
  };
}
