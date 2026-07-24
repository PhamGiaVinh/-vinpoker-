// floorAdapter — PURE mapping từ dữ liệu floor THẬT (tournament_tables + get_seats) sang
// shape MockTable/MockSeat mà RoomGrid/PlayerActionSheets đang nhận. Không React, không IO.
//
// P0-5 (review owner): status bàn phải GIỐNG HỆT desktop — tableStatus() + chuẩn hoá canonical
// table-id dưới đây được COPY NGUYÊN VĂN từ FloorTableMapPanel.tsx (không suy luận mới).
// Nếu desktop đổi logic, sửa ở đó rồi đồng bộ lại đây (kèm test).

import type { MockTable, MockSeat } from "@/components/ops/mock/opsData";
import type { MapSeat, MapTable } from "@/components/cashier/tournament-live/FloorTableDetailSheet";

export type { MapSeat, MapTable };

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
