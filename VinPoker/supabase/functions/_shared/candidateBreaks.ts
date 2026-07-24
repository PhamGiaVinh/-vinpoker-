export const CANDIDATE_BREAK_QUERY_CHUNK_SIZE = 50;

export interface ActiveAttendanceBreakRow {
  attendance_id: string | null;
  break_start: string;
}

export interface ActiveLegacyAssignmentBreakRow {
  assignment_id: string | null;
  break_start: string;
  dealer_assignments: { attendance_id: string | null } | null;
}

export interface CandidateBreakQueryResult<Row> {
  data: Row[] | null;
  error: unknown | null;
}

export interface CandidateBreakQueries {
  loadAttendanceLinked: (
    attendanceIds: string[],
  ) => Promise<CandidateBreakQueryResult<ActiveAttendanceBreakRow>>;
  loadLegacyAssignmentLinked: (
    attendanceIds: string[],
  ) => Promise<CandidateBreakQueryResult<ActiveLegacyAssignmentBreakRow>>;
}

export interface CandidateBreakQueryFailure {
  stage: "attendance_breaks" | "assignment_breaks";
  error: unknown;
  inputCount: number;
  durationMs: number;
}

export type CandidateBreakLoadResult =
  | { ok: true; activeBreakByAttendanceId: Map<string, string> }
  | { ok: false; failure: CandidateBreakQueryFailure };

/**
 * The database relation is one-to-one for current rows, but selecting the
 * earliest start makes a duplicate/inconsistent response deterministic and
 * still conservatively excludes the dealer from the candidate pool.
 */
function recordBreak(
  activeBreakByAttendanceId: Map<string, string>,
  attendanceId: string | null,
  breakStart: string,
): void {
  if (!attendanceId) return;
  const existing = activeBreakByAttendanceId.get(attendanceId);
  if (!existing || breakStart < existing) {
    activeBreakByAttendanceId.set(attendanceId, breakStart);
  }
}

export function uniqueSortedIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))].sort((left, right) =>
    left.localeCompare(right)
  );
}

export function chunkIds(ids: readonly string[], chunkSize = CANDIDATE_BREAK_QUERY_CHUNK_SIZE): string[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("candidate_break_invalid_chunk_size");
  }

  const uniqueIds = uniqueSortedIds(ids);
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    chunks.push(uniqueIds.slice(index, index + chunkSize));
  }
  return chunks;
}

/**
 * Loads only open breaks for the supplied active attendance rows. Newer rows
 * are linked directly through attendance_id. The second query preserves the
 * assignment-linked legacy path without expanding one attendance into every
 * historical assignment. Every query is bounded, ordered, and fail-closed.
 */
export async function loadCandidateActiveBreaks(
  attendanceIds: readonly string[],
  queries: CandidateBreakQueries,
  now: () => number = Date.now,
): Promise<CandidateBreakLoadResult> {
  const activeBreakByAttendanceId = new Map<string, string>();

  for (const chunk of chunkIds(attendanceIds)) {
    const attendanceStartedAt = now();
    const attendanceResult = await queries.loadAttendanceLinked(chunk);
    if (attendanceResult.error) {
      return {
        ok: false,
        failure: {
          stage: "attendance_breaks",
          error: attendanceResult.error,
          inputCount: chunk.length,
          durationMs: Math.max(0, now() - attendanceStartedAt),
        },
      };
    }
    for (const row of attendanceResult.data ?? []) {
      recordBreak(activeBreakByAttendanceId, row.attendance_id, row.break_start);
    }

    const legacyStartedAt = now();
    const legacyResult = await queries.loadLegacyAssignmentLinked(chunk);
    if (legacyResult.error) {
      return {
        ok: false,
        failure: {
          stage: "assignment_breaks",
          error: legacyResult.error,
          inputCount: chunk.length,
          durationMs: Math.max(0, now() - legacyStartedAt),
        },
      };
    }
    for (const row of legacyResult.data ?? []) {
      recordBreak(activeBreakByAttendanceId, row.dealer_assignments?.attendance_id ?? null, row.break_start);
    }
  }

  return { ok: true, activeBreakByAttendanceId };
}
