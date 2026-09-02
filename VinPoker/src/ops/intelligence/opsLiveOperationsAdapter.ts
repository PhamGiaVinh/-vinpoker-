import type { SupabaseClient } from "@supabase/supabase-js";
import { derivePreAssignStatus, pickPreferredAssignment, type AssignmentShadowLike } from "@/lib/dealerSwingState";
import type { Database } from "@/integrations/supabase/types";
import type { OpsLiveOperationInputV1, OpsOperationRowV1, OpsSourceAvailabilityV1 } from "./opsIntelligenceReadModel";

type OpsClient = SupabaseClient<Database>;

type TableRow = {
  id: string;
  table_name: string;
  status: string;
  current_blind_level: number | null;
};

type TournamentRow = {
  id: string;
  name: string;
  status: string;
  current_level: number | null;
  average_stack: number | null;
  tournament_tables: { table_id: string; status: string }[] | null;
};

type AssignmentRow = AssignmentShadowLike & {
  id: string;
  table_id: string;
  attendance_id: string;
  status: string;
  pre_assigned_attendance_id: string | null;
  pre_assigned_at: string | null;
  swing_in_progress: boolean | null;
  last_swing_attempted_at: string | null;
  swing_due_at: string | null;
  dealer_attendance: {
    current_state: string | null;
    dealers: { full_name: string | null } | null;
  } | null;
};

type AttendanceRow = {
  id: string;
  dealer_id: string;
  check_in_time: string | null;
};

type QueryOutcome<T> = { readonly data: readonly T[]; readonly error: string | null };

export async function loadOpsLiveOperations(
  client: OpsClient,
  clubId: string,
  options: { readonly q0CapacityTruth?: boolean } = {},
): Promise<OpsLiveOperationInputV1> {
  const [tablesResult, tournamentsResult, assignmentsResult, attendanceResult] = await Promise.all([
    client.from("game_tables")
      .select("id,table_name,status,current_blind_level")
      .eq("club_id", clubId)
      .order("table_name"),
    client.from("tournaments")
      .select("id,name,status,current_level,average_stack,tournament_tables(table_id,status)")
      .eq("club_id", clubId)
      .in("status", ["drawing", "live", "break", "final_table"]),
    client.from("dealer_assignments")
      .select("id,attendance_id,table_id,assigned_at,released_at,status,version,updated_at,last_swing_attempted_at,swing_in_progress,swing_processed_at,swing_due_at,pre_assigned_attendance_id,pre_assigned_at,dealer_attendance!attendance_id(current_state,dealers(full_name))")
      .eq("club_id", clubId)
      .eq("status", "assigned")
      .order("assigned_at", { ascending: true }),
    client.from("dealer_attendance")
      .select("id,dealer_id,check_in_time,dealers!inner(club_id,deleted_at)")
      .eq("status", "checked_in")
      .eq("dealers.club_id", clubId)
      .is("dealers.deleted_at", null)
      .order("check_in_time", { ascending: true }),
  ]);
  const observedAt = new Date().toISOString();
  const tables = normalize<TableRow>(tablesResult);
  const tournaments = normalize<TournamentRow>(tournamentsResult);
  const assignments = normalize<AssignmentRow>(assignmentsResult);
  const attendance = normalize<AttendanceRow>(attendanceResult);

  if (tables.error) return Object.freeze({
    observedAt,
    asOf: null,
    availability: "unavailable",
    reasonCode: "OPS_LIVE_TABLES_READ_FAILED",
    rows: Object.freeze([]),
    runningTournamentIds: Object.freeze([]),
    openTableCount: null,
    configuredTableCount: null,
    operationalTableCount: null,
    dealersOnDutyCount: null,
    countComparisonEligible: false,
  });

  const availability: OpsSourceAvailabilityV1 = tournaments.error || assignments.error || attendance.error ? "partial" : "exact";
  const asOf = maxTimestamp([
    ...tournaments.data.map((item) => (item as unknown as { updated_at?: string | null }).updated_at ?? null),
    ...assignments.data.map((item) => item.updated_at ?? null),
  ]);
  const assignmentByTable = canonicalAssignments(assignments.data, Date.parse(observedAt));
  const tournamentByTable = mapTournamentsByTable(tournaments.data);
  const capacity = deriveOpsTableCapacityQ0(tables.data.map((table) => table.id), tournaments.data);
  const activeTournamentTableIds = new Set(capacity.activeTableIds);
  const rowTables = options.q0CapacityTruth
    ? tables.data.filter((table) => activeTournamentTableIds.has(table.id))
    : tables.data;
  const rows = rowTables.map((table) => toOperationRow(
    table,
    tournamentByTable.get(table.id) ?? null,
    assignments.error ? null : assignmentByTable.get(table.id) ?? null,
    availability,
    Date.parse(observedAt),
  ));

  return Object.freeze({
    observedAt,
    asOf,
    availability,
    reasonCode: availability === "exact" ? null : firstErrorCode({ tournaments, assignments, attendance }),
    rows: Object.freeze(rows),
    runningTournamentIds: Object.freeze(tournaments.data.map((tournament) => tournament.id).sort()),
    openTableCount: options.q0CapacityTruth
      ? activeTournamentTableIds.size
      : tables.data.filter((table) => isOpenTable(table.status)).length,
    configuredTableCount: capacity.configuredTableCount,
    operationalTableCount: options.q0CapacityTruth ? capacity.operationalTableCount : rows.length,
    dealersOnDutyCount: attendance.error ? null : dedupeCheckedInAttendance(attendance.data).length,
    countComparisonEligible: Boolean(options.q0CapacityTruth) && !tournaments.error,
  });
}

export function deriveOpsTableCapacityQ0(
  configuredTableIds: readonly string[],
  tournaments: readonly Pick<TournamentRow, "tournament_tables">[],
): { readonly configuredTableCount: number; readonly operationalTableCount: number; readonly activeTableIds: readonly string[] } {
  const configured = new Set(configuredTableIds);
  const active = new Set<string>();
  for (const tournament of tournaments) {
    for (const link of tournament.tournament_tables ?? []) {
      if (link.status === "active" && configured.has(link.table_id)) active.add(link.table_id);
    }
  }
  return Object.freeze({ configuredTableCount: configured.size, operationalTableCount: active.size, activeTableIds: Object.freeze([...active].sort()) });
}

function normalize<T>(result: { data: unknown; error: { message?: string } | null }): QueryOutcome<T> {
  return Object.freeze({
    data: Object.freeze(Array.isArray(result.data) ? result.data as T[] : []),
    error: result.error?.message ?? null,
  });
}

function mapTournamentsByTable(tournaments: readonly TournamentRow[]): ReadonlyMap<string, TournamentRow> {
  const result = new Map<string, TournamentRow>();
  for (const tournament of tournaments) {
    for (const item of tournament.tournament_tables ?? []) {
      if (item.status === "active") result.set(item.table_id, tournament);
    }
  }
  return result;
}

function canonicalAssignments(rows: readonly AssignmentRow[], nowMs: number): ReadonlyMap<string, AssignmentRow> {
  const result = new Map<string, AssignmentRow>();
  for (const assignment of rows) {
    result.set(assignment.table_id, pickPreferredAssignment(result.get(assignment.table_id), assignment, nowMs));
  }
  return result;
}

function toOperationRow(
  table: TableRow,
  tournament: TournamentRow | null,
  assignment: AssignmentRow | null,
  availability: OpsSourceAvailabilityV1,
  nowMs: number,
): OpsOperationRowV1 {
  const dealerAssignmentState = deriveDealerAssignmentState(assignment, nowMs);
  return Object.freeze({
    tableId: table.id,
    tableName: table.table_name,
    tableStatus: table.status,
    tournamentId: tournament?.id ?? null,
    tournamentName: tournament?.name ?? null,
    currentLevel: tournament?.current_level ?? null,
    averageStack: tournament?.average_stack ?? null,
    dealerName: assignment?.dealer_attendance?.dealers?.full_name ?? null,
    dealerAssignmentState,
    sourceAvailability: availability,
  });
}

/** Same due/pre-assignment semantics as Dealer Swing; no new Ops threshold. */
export function deriveDealerAssignmentState(
  assignment: Pick<AssignmentRow, "swing_due_at" | "pre_assigned_attendance_id" | "pre_assigned_at" | "swing_in_progress" | "updated_at" | "last_swing_attempted_at" | "released_at" | "swing_processed_at" | "status"> | null,
  nowMs: number,
): "assigned" | "missing" | "overdue" {
  if (!assignment) return "missing";
  const preAssignStatus = derivePreAssignStatus(assignment, nowMs);
  const dueAt = assignment.swing_due_at ? Date.parse(assignment.swing_due_at) : Number.NaN;
  return Number.isFinite(dueAt) && dueAt < nowMs && preAssignStatus !== "valid" && preAssignStatus !== "in_progress"
    ? "overdue"
    : "assigned";
}

function isOpenTable(status: string): boolean {
  return ["active", "open", "playing"].includes(status);
}

function dedupeCheckedInAttendance(rows: readonly AttendanceRow[]): readonly AttendanceRow[] {
  const result = new Map<string, AttendanceRow>();
  for (const row of rows) {
    const existing = result.get(row.dealer_id);
    if (!existing || (row.check_in_time ?? "") > (existing.check_in_time ?? "")) result.set(row.dealer_id, row);
  }
  return Object.freeze([...result.values()]);
}

function maxTimestamp(values: readonly (string | null)[]): string | null {
  const valid = values.filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
  if (!valid.length) return null;
  return valid.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}

function firstErrorCode(input: Record<string, QueryOutcome<unknown>>): string {
  const entry = Object.entries(input).find(([, result]) => result.error);
  return entry ? `OPS_LIVE_${entry[0].toUpperCase()}_READ_FAILED` : "OPS_LIVE_PARTIAL";
}
