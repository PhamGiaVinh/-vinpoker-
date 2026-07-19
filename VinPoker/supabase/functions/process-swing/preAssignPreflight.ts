export interface PreAssignAttendanceRow {
  current_state: string;
  status: string;
  last_released_at: string | null;
  dealers?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
}

export interface NormalizedPreAssignAttendance {
  current_state: string;
  status: string;
  last_released_at: string | null;
  full_name: string;
}

export type PreAssignPreflight =
  | { kind: "query_error"; error: string }
  | { kind: "invalid"; attendance: NormalizedPreAssignAttendance | null }
  | { kind: "rest_blocked"; attendance: NormalizedPreAssignAttendance; restMinutes: number }
  | { kind: "ready"; attendance: NormalizedPreAssignAttendance; restMinutes: number };

export function assessPreAssignPreflight(
  row: PreAssignAttendanceRow | null,
  error: { message: string } | null,
  minimumRestMinutes: number,
  nowMs = Date.now(),
): PreAssignPreflight {
  if (error) return { kind: "query_error", error: error.message };
  if (!row) return { kind: "invalid", attendance: null };

  const nestedDealer = Array.isArray(row.dealers) ? row.dealers[0] : row.dealers;
  const attendance: NormalizedPreAssignAttendance = {
    current_state: row.current_state,
    status: row.status,
    last_released_at: row.last_released_at,
    full_name: nestedDealer?.full_name ?? "Unknown",
  };

  if (attendance.status !== "checked_in" || attendance.current_state !== "pre_assigned") {
    return { kind: "invalid", attendance };
  }

  const restMinutes = attendance.last_released_at
    ? (nowMs - new Date(attendance.last_released_at).getTime()) / 60_000
    : Number.POSITIVE_INFINITY;
  if (restMinutes < minimumRestMinutes) {
    return { kind: "rest_blocked", attendance, restMinutes };
  }
  return { kind: "ready", attendance, restMinutes };
}
