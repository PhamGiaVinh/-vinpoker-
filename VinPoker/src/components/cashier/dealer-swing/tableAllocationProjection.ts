import type { DealerAssignment, GameTableRow } from "@/hooks/useDealerSwing";
import type { RotationScheduleRow } from "@/hooks/useRotationSchedule";

export const TABLE_ALLOCATION_WINDOW_MINUTES = 90;

export type TableAllocationCoverage = "covered" | "gap" | "conflict" | "scheduled" | "closed";
export type TableAllocationState = "open" | "scheduled" | "closed";
export type TableAllocationSegmentStatus =
  | "active"
  | "locked"
  | "executing"
  | "predicted"
  | "gap"
  | "scheduled"
  | "conflict"
  | "shortage"
  | "delayed";

export interface TableAllocationSegment {
  id: string;
  tableId: string;
  dealerName: string | null;
  startAt: string;
  /** Null is meaningful: the next boundary is not proven by the live data. */
  endAt: string | null;
  openEnded: boolean;
  status: TableAllocationSegmentStatus;
  label: string;
  source: "assignment" | "rotation_slot" | "derived_gap" | "derived_scheduled" | "derived_conflict";
  assignmentId?: string | null;
  slotId?: string | null;
}

export interface TableAllocationMarker {
  id: string;
  tableId: string;
  dealerName: string | null;
  at: string | null;
  status: TableAllocationSegmentStatus;
  label: string;
  slotId?: string | null;
}

export interface TableAllocationConflict {
  code: "multiple_assignments" | "dealer_multiple_tables" | "inactive_table_assignment" | "missing_canonical_assignment";
  label: string;
}

export interface TableAllocationRow {
  tableId: string;
  tableName: string;
  areaLabel: null;
  tableState: TableAllocationState;
  requiresCoverage: boolean;
  coverage: TableAllocationCoverage;
  activeAssignment: DealerAssignment | null;
  gapStartedAt: string | null;
  segments: TableAllocationSegment[];
  markers: TableAllocationMarker[];
  conflicts: TableAllocationConflict[];
}

export interface BuildTableAllocationRowsInput {
  tables: GameTableRow[];
  canonicalAssignments: DealerAssignment[];
  activeRawData: DealerAssignment[];
  scheduleRows: RotationScheduleRow[];
  nowMs: number;
  selectedTour?: string | null;
  searchTerm?: string;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function naturalTableOrder(a: string, b: string): number {
  const aNumber = Number.parseInt(a.match(/\d+/)?.[0] ?? "", 10);
  const bNumber = Number.parseInt(b.match(/\d+/)?.[0] ?? "", 10);
  const aKey = Number.isFinite(aNumber) ? aNumber : Number.MAX_SAFE_INTEGER;
  const bKey = Number.isFinite(bNumber) ? bNumber : Number.MAX_SAFE_INTEGER;
  return aKey - bKey || a.localeCompare(b, "vi");
}

function dealerName(assignment: DealerAssignment | null | undefined): string | null {
  return assignment?.dealer_attendance?.dealers?.full_name ?? null;
}

function statusRank(row: RotationScheduleRow): number {
  if (row.status === "executing") return 3;
  if (row.status === "announced") return 2;
  if (row.status === "predicted") return 1;
  return 0;
}

/** Mirrors the existing hook's slot winner semantics without adding a query. */
function canonicalScheduleSlots(rows: RotationScheduleRow[]): RotationScheduleRow[] {
  const bySlot = new Map<number, RotationScheduleRow>();
  for (const row of rows) {
    const current = bySlot.get(row.slot_index);
    if (!current) {
      bySlot.set(row.slot_index, row);
      continue;
    }
    const rankDelta = statusRank(row) - statusRank(current);
    const rowUpdated = parseTimestamp(row.updated_at) ?? 0;
    const currentUpdated = parseTimestamp(current.updated_at) ?? 0;
    if (rankDelta > 0 || (rankDelta === 0 && rowUpdated > currentUpdated) || (rankDelta === 0 && rowUpdated === currentUpdated && row.id.localeCompare(current.id) > 0)) {
      bySlot.set(row.slot_index, row);
    }
  }
  return [...bySlot.values()].sort((a, b) => a.slot_index - b.slot_index);
}

function hasOpeningEvidence(
  table: GameTableRow,
  rows: RotationScheduleRow[],
  windowStartMs: number,
  windowEndMs: number,
): boolean {
  return Boolean(table.dealer_open_operation_id)
    || canonicalScheduleSlots(rows).some((row) => {
      if (row.status !== "announced" && row.status !== "executing") return false;
      const plannedMs = parseTimestamp(row.planned_relief_at);
      return plannedMs != null && plannedMs >= windowStartMs && plannedMs <= windowEndMs;
    });
}

function hasDelayedIncomingDealer(row: RotationScheduleRow): boolean {
  return row.is_shortage && Boolean(row.in_attendance_id);
}

function futureSegmentStatus(row: RotationScheduleRow): TableAllocationSegmentStatus {
  if (hasDelayedIncomingDealer(row)) return "delayed";
  if (row.is_shortage) return "shortage";
  if (row.status === "predicted") return "predicted";
  if (row.status === "executing") return "executing";
  return "locked";
}

function futureSegmentLabel(row: RotationScheduleRow): string {
  if (hasDelayedIncomingDealer(row)) return "DỰ KIẾN TRỄ";
  if (row.is_shortage) return "THIẾU DEALER DỰ KIẾN";
  if (row.status === "predicted") return "DỰ ĐOÁN";
  if (row.status === "executing") return "ĐANG THỰC HIỆN";
  return "CHỐT";
}

function overdueLabel(row: RotationScheduleRow): string {
  if (hasDelayedIncomingDealer(row)) return "DỰ KIẾN TRỄ QUÁ GIỜ";
  if (row.is_shortage) return "THIẾU DEALER DỰ KIẾN QUÁ GIỜ";
  if (row.status === "predicted") return "DỰ ĐOÁN QUÁ GIỜ";
  if (row.status === "executing") return "ĐANG THỰC HIỆN";
  return "CHỐT QUÁ GIỜ";
}

function markerFor(
  row: RotationScheduleRow,
  at: string | null,
  label: string,
  status: TableAllocationSegmentStatus = futureSegmentStatus(row),
): TableAllocationMarker {
  return {
    id: `marker:${row.id}:${label}`,
    tableId: row.table_id,
    dealerName: row.in_attendance_id ? row.in_dealer_name : null,
    at,
    status,
    label,
    slotId: row.id,
  };
}

function initialSegment(
  table: GameTableRow,
  coverage: TableAllocationCoverage,
  canonical: DealerAssignment | null,
  conflicts: TableAllocationConflict[],
  gapStartedAt: string | null,
  nowMs: number,
): TableAllocationSegment {
  const startAt = toIso(nowMs);
  if (conflicts.length > 0) {
    return {
      id: `conflict:${table.id}`,
      tableId: table.id,
      dealerName: null,
      startAt,
      endAt: null,
      openEnded: true,
      status: "conflict",
      label: "XUNG ĐỘT",
      source: "derived_conflict",
    };
  }
  if (canonical && coverage === "covered") {
    return {
      id: `assignment:${canonical.id}`,
      tableId: table.id,
      dealerName: dealerName(canonical),
      startAt,
      endAt: null,
      openEnded: true,
      status: "active",
      label: "ĐANG BÀN",
      source: "assignment",
      assignmentId: canonical.id,
    };
  }
  if (coverage === "scheduled") {
    return {
      id: `scheduled:${table.id}`,
      tableId: table.id,
      dealerName: null,
      startAt,
      endAt: null,
      openEnded: true,
      status: "scheduled",
      label: "SẮP MỞ",
      source: "derived_scheduled",
    };
  }
  return {
    id: `gap:${table.id}`,
    tableId: table.id,
    dealerName: null,
    startAt,
    endAt: null,
    openEnded: true,
    status: "gap",
    label: gapStartedAt ? "TRỐNG" : "TRỐNG · chưa rõ từ lúc nào",
    source: "derived_gap",
  };
}

/**
 * Builds only evidence-backed bands. A rotation row never replaces the current
 * assignment until the source assignment actually changes; uncertain rows stay
 * as markers so the UI cannot invent a dealer handover.
 */
function buildTimeline(
  table: GameTableRow,
  coverage: TableAllocationCoverage,
  canonical: DealerAssignment | null,
  conflicts: TableAllocationConflict[],
  gapStartedAt: string | null,
  schedules: RotationScheduleRow[],
  nowMs: number,
  endMs: number,
): Pick<TableAllocationRow, "segments" | "markers"> {
  const segments = [initialSegment(table, coverage, canonical, conflicts, gapStartedAt, nowMs)];
  const markers: TableAllocationMarker[] = [];
  const slots = canonicalScheduleSlots(schedules);
  let expectedSlotIndex = 0;
  let priorBoundaryMs = nowMs;
  let currentAttendanceId: string | null = canonical?.attendance_id ?? null;
  let chainBroken = conflicts.length > 0;

  for (const slot of slots) {
    const plannedMs = parseTimestamp(slot.planned_relief_at);
    const markerAt = plannedMs == null ? null : toIso(plannedMs <= nowMs ? nowMs : plannedMs);

    if (chainBroken || slot.slot_index !== expectedSlotIndex) {
      const label = plannedMs == null
        ? "LỊCH CHƯA CÓ GIỜ"
        : plannedMs <= nowMs
          ? overdueLabel(slot)
          : "LỊCH KHÔNG LIÊN TỤC";
      markers.push(markerFor(slot, markerAt, label, plannedMs != null && plannedMs <= nowMs ? futureSegmentStatus(slot) : "conflict"));
      chainBroken = true;
      continue;
    }
    expectedSlotIndex += 1;

    if (plannedMs == null) {
      markers.push(markerFor(slot, null, "LỊCH CHƯA CÓ GIỜ", "conflict"));
      chainBroken = true;
      continue;
    }
    if (plannedMs <= nowMs) {
      markers.push(markerFor(slot, toIso(nowMs), overdueLabel(slot)));
      chainBroken = true;
      continue;
    }
    if (plannedMs <= priorBoundaryMs) {
      markers.push(markerFor(slot, toIso(plannedMs), "MỐC ĐỔI CA KHÔNG HỢP LỆ", "conflict"));
      chainBroken = true;
      continue;
    }
    if (slot.slot_index === 0 && canonical && slot.assignment_id && slot.assignment_id !== canonical.id) {
      markers.push(markerFor(slot, toIso(plannedMs), "LỊCH THUỘC ASSIGNMENT CŨ", "conflict"));
      chainBroken = true;
      continue;
    }
    if (slot.out_attendance_id !== currentAttendanceId) {
      markers.push(markerFor(slot, toIso(plannedMs), "LỊCH KHÔNG KHỚP DEALER", "conflict"));
      chainBroken = true;
      continue;
    }
    if (!slot.is_shortage && !slot.in_attendance_id) {
      markers.push(markerFor(slot, toIso(plannedMs), "LỊCH XUNG ĐỘT · THIẾU DEALER", "conflict"));
      chainBroken = true;
      continue;
    }

    const current = segments[segments.length - 1];
    current.endAt = toIso(plannedMs);
    current.openEnded = false;
    priorBoundaryMs = plannedMs;

    // The known next boundary sits beyond the visible 90-minute viewport. Keep
    // the semantic end time, but do not add an off-screen band.
    if (plannedMs >= endMs) break;

    segments.push({
      id: `rotation:${slot.id}`,
      tableId: table.id,
      dealerName: slot.in_attendance_id ? slot.in_dealer_name : null,
      startAt: toIso(plannedMs),
      endAt: null,
      openEnded: true,
      status: futureSegmentStatus(slot),
      label: futureSegmentLabel(slot),
      source: "rotation_slot",
      slotId: slot.id,
    });
    currentAttendanceId = slot.in_attendance_id;
  }

  return { segments, markers };
}

/**
 * Read-only projection for the Table Allocation View. It deliberately sees both
 * the canonical active-assignment list and the pre-canonical raw active rows so
 * that a duplicate assignment is surfaced instead of silently hidden.
 */
export function buildTableAllocationRows(input: BuildTableAllocationRowsInput): TableAllocationRow[] {
  const endMs = input.nowMs + TABLE_ALLOCATION_WINDOW_MINUTES * 60_000;
  const search = input.searchTerm?.trim().toLocaleLowerCase("vi") ?? "";
  const rawByTable = new Map<string, DealerAssignment[]>();
  const tableIdsByAttendance = new Map<string, Set<string>>();
  const schedulesByTable = new Map<string, RotationScheduleRow[]>();
  const canonicalByTable = new Map(input.canonicalAssignments.map((assignment) => [assignment.table_id, assignment]));

  for (const assignment of input.activeRawData) {
    if (assignment.status !== "assigned" || assignment.released_at) continue;
    const rows = rawByTable.get(assignment.table_id) ?? [];
    rows.push(assignment);
    rawByTable.set(assignment.table_id, rows);

    const tableIds = tableIdsByAttendance.get(assignment.attendance_id) ?? new Set<string>();
    tableIds.add(assignment.table_id);
    tableIdsByAttendance.set(assignment.attendance_id, tableIds);
  }

  for (const schedule of input.scheduleRows) {
    const rows = schedulesByTable.get(schedule.table_id) ?? [];
    rows.push(schedule);
    schedulesByTable.set(schedule.table_id, rows);
  }

  return input.tables
    .flatMap((table): TableAllocationRow[] => {
      const rawAssignments = rawByTable.get(table.id) ?? [];
      const tableSchedules = schedulesByTable.get(table.id) ?? [];
      const active = table.status === "active";
      const openingEvidence = hasOpeningEvidence(table, tableSchedules, input.nowMs, endMs);

      // A raw assignment on an inactive table is still shown as a conflict. This
      // keeps a ghost row observable without counting the table as coverage.
      if (!active && !openingEvidence && rawAssignments.length === 0) return [];
      if (input.selectedTour && table.shift_id !== input.selectedTour) return [];

      const canonical = canonicalByTable.get(table.id) ?? null;
      const conflicts: TableAllocationConflict[] = [];
      if (rawAssignments.length > 1) {
        conflicts.push({ code: "multiple_assignments", label: `Có ${rawAssignments.length} assignment active cùng lúc` });
      }
      if (rawAssignments.length === 1 && !canonical) {
        conflicts.push({ code: "missing_canonical_assignment", label: "Assignment active chưa có bản canonical để hiển thị" });
      }
      if (!active && rawAssignments.length > 0) {
        conflicts.push({ code: "inactive_table_assignment", label: "Assignment active đang trỏ vào bàn không active" });
      }
      for (const assignment of rawAssignments) {
        if ((tableIdsByAttendance.get(assignment.attendance_id)?.size ?? 0) > 1) {
          conflicts.push({ code: "dealer_multiple_tables", label: `${dealerName(assignment) ?? "Dealer"} đang active ở nhiều bàn` });
          break;
        }
      }

      const requiresCoverage = active;
      const coverage: TableAllocationCoverage = conflicts.length > 0
        ? "conflict"
        : requiresCoverage
          ? rawAssignments.length === 1 && canonical ? "covered" : "gap"
          : openingEvidence ? "scheduled" : "closed";
      const openedAtMs = parseTimestamp(table.opened_at);
      const gapStartedAt = coverage === "gap" && openedAtMs != null && openedAtMs <= input.nowMs
        ? table.opened_at ?? null
        : null;
      const timeline = buildTimeline(table, coverage, canonical, conflicts, gapStartedAt, tableSchedules, input.nowMs, endMs);

      const searchable = [
        table.table_name,
        dealerName(canonical),
        ...rawAssignments.map(dealerName),
        ...tableSchedules.map((schedule) => schedule.in_dealer_name),
      ].filter(Boolean).join(" ").toLocaleLowerCase("vi");
      if (search && !searchable.includes(search)) return [];

      return [{
        tableId: table.id,
        tableName: table.table_name,
        areaLabel: null,
        tableState: active ? "open" : openingEvidence ? "scheduled" : "closed",
        requiresCoverage,
        coverage,
        activeAssignment: canonical,
        gapStartedAt,
        ...timeline,
        conflicts,
      }];
    })
    .sort((a, b) => naturalTableOrder(a.tableName, b.tableName));
}
