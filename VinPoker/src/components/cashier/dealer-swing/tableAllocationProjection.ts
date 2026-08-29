import type { DealerAssignment, GameTableRow } from "@/hooks/useDealerSwing";
import type { RotationScheduleRow } from "@/hooks/useRotationSchedule";

export const TABLE_ALLOCATION_WINDOW_MINUTES = 90;

export type TableAllocationCoverage = "covered" | "gap" | "conflict" | "scheduled" | "closed";
export type TableAllocationState = "open" | "scheduled" | "closed";
export type TableAllocationSegmentStatus = "active" | "locked" | "executing" | "predicted" | "gap";

export interface TableAllocationSegment {
  id: string;
  tableId: string;
  dealerName: string | null;
  startAt: string | null;
  status: TableAllocationSegmentStatus;
  label: string;
  source: "assignment" | "rotation_slot" | "derived_gap";
  assignmentId?: string | null;
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
  unplacedSlots: TableAllocationSegment[];
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

function scheduleLabel(row: RotationScheduleRow): string {
  if (row.status === "predicted") return "DỰ ĐOÁN";
  if (row.status === "executing") return "ĐANG THỰC HIỆN ĐỔI DEALER";
  return "CHỐT";
}

function scheduleStatus(row: RotationScheduleRow): TableAllocationSegmentStatus {
  if (row.status === "predicted") return "predicted";
  if (row.status === "executing") return "executing";
  return "locked";
}

function hasOpeningEvidence(
  table: GameTableRow,
  rows: RotationScheduleRow[],
  windowStartMs: number,
  windowEndMs: number,
): boolean {
  return Boolean(table.dealer_open_operation_id)
    || rows.some((row) => {
      if (row.status !== "announced" && row.status !== "executing") return false;
      const plannedMs = parseTimestamp(row.planned_relief_at);
      return plannedMs != null && plannedMs >= windowStartMs && plannedMs <= windowEndMs;
    });
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
        conflicts.push({
          code: "multiple_assignments",
          label: `Có ${rawAssignments.length} assignment active cùng lúc`,
        });
      }
      if (rawAssignments.length === 1 && !canonical) {
        conflicts.push({
          code: "missing_canonical_assignment",
          label: "Assignment active chưa có bản canonical để hiển thị",
        });
      }
      if (!active && rawAssignments.length > 0) {
        conflicts.push({
          code: "inactive_table_assignment",
          label: "Assignment active đang trỏ vào bàn không active",
        });
      }
      for (const assignment of rawAssignments) {
        if ((tableIdsByAttendance.get(assignment.attendance_id)?.size ?? 0) > 1) {
          conflicts.push({
            code: "dealer_multiple_tables",
            label: `${dealerName(assignment) ?? "Dealer"} đang active ở nhiều bàn`,
          });
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
      const segments: TableAllocationSegment[] = [];
      const unplacedSlots: TableAllocationSegment[] = [];

      if (canonical && rawAssignments.length === 1) {
        const assignedAtMs = parseTimestamp(canonical.assigned_at) ?? input.nowMs;
        segments.push({
          id: `assignment:${canonical.id}`,
          tableId: table.id,
          dealerName: dealerName(canonical),
          startAt: new Date(Math.max(assignedAtMs, input.nowMs)).toISOString(),
          status: "active",
          label: "ĐANG BÀN",
          source: "assignment",
          assignmentId: canonical.id,
        });
      }

      if (coverage === "gap") {
        segments.push({
          id: `gap:${table.id}`,
          tableId: table.id,
          dealerName: null,
          // Null means a current-state marker, not a fabricated gap start.
          startAt: gapStartedAt,
          status: "gap",
          label: gapStartedAt ? "TRỐNG" : "TRỐNG · chưa rõ từ lúc nào",
          source: "derived_gap",
        });
      }

      for (const schedule of tableSchedules) {
        const marker: TableAllocationSegment = {
          id: `rotation:${schedule.id}`,
          tableId: table.id,
          dealerName: schedule.in_dealer_name,
          startAt: schedule.planned_relief_at,
          status: scheduleStatus(schedule),
          label: scheduleLabel(schedule),
          source: "rotation_slot",
          slotId: schedule.id,
        };
        const plannedMs = parseTimestamp(schedule.planned_relief_at);
        if (plannedMs != null && plannedMs >= input.nowMs && plannedMs <= endMs) {
          segments.push(marker);
        } else if (plannedMs == null) {
          unplacedSlots.push(marker);
        }
      }

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
        segments: segments.sort((a, b) => {
          const aMs = parseTimestamp(a.startAt) ?? input.nowMs;
          const bMs = parseTimestamp(b.startAt) ?? input.nowMs;
          return aMs - bMs || a.id.localeCompare(b.id);
        }),
        unplacedSlots,
        conflicts,
      }];
    })
    .sort((a, b) => naturalTableOrder(a.tableName, b.tableName));
}
