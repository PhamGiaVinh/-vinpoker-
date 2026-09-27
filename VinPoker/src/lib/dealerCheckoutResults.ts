import { isFreshDealerPoolAttendance } from "../../supabase/functions/_shared/checkoutSafety.ts";

export interface DealerCheckoutResult {
  attendance_id?: string;
  success?: boolean;
  code?: string;
  error?: string;
  dealer_name?: string;
  released_pre_assigned?: boolean;
  pre_assigned_table?: string | null;
  idempotent?: boolean;
  [key: string]: unknown;
}

export const STALE_ATTENDANCE_REQUIRES_CLEANUP = "STALE_ATTENDANCE_REQUIRES_CLEANUP";

export interface CheckoutCandidateAttendance {
  id: string;
  check_in_time: string | null;
}

export interface CheckoutScopedAttendance extends CheckoutCandidateAttendance {
  dealers?: { club_id?: string | null } | Array<{ club_id?: string | null }> | null;
}

export type CheckoutBatchScopeResult =
  | { ok: true; attendanceIds: string[] }
  | {
      ok: false;
      code: "CLUB_REQUIRED" | "ATTENDANCE_SCOPE_UNKNOWN" | "ATTENDANCE_CLUB_MISMATCH";
    };

function attendanceClubId(attendance: CheckoutScopedAttendance): string | null {
  const dealer = Array.isArray(attendance.dealers) ? attendance.dealers[0] : attendance.dealers;
  return dealer?.club_id ?? null;
}

export function scopeCheckoutAttendanceIds(
  attendance: CheckoutScopedAttendance[],
  requestedIds: string[],
  activeClubId: string | null,
): CheckoutBatchScopeResult {
  if (!activeClubId) return { ok: false, code: "CLUB_REQUIRED" };

  const requested = [...new Set(requestedIds.filter(Boolean))];
  const byId = new Map(attendance.map((row) => [row.id, row]));
  for (const attendanceId of requested) {
    const row = byId.get(attendanceId);
    const clubId = row ? attendanceClubId(row) : null;
    if (!row || !clubId) {
      return { ok: false, code: "ATTENDANCE_SCOPE_UNKNOWN" };
    }
    if (clubId !== activeClubId) {
      return { ok: false, code: "ATTENDANCE_CLUB_MISMATCH" };
    }
  }

  return { ok: true, attendanceIds: requested };
}

function isFreshCheckoutCandidate(
  attendance: CheckoutCandidateAttendance,
  nowMs: number,
): boolean {
  return Boolean(attendance.id)
    && isFreshDealerPoolAttendance(attendance.check_in_time, nowMs);
}

export function selectFreshDealerPoolAttendance<T extends CheckoutCandidateAttendance>(
  attendance: T[],
  nowMs = Date.now(),
): T[] {
  return attendance.filter((row) => isFreshCheckoutCandidate(row, nowMs));
}

export function selectOperationalDealerAttendance<T extends CheckoutCandidateAttendance>(
  attendance: T[],
  activeAssignmentAttendanceIds: ReadonlySet<string>,
  nowMs = Date.now(),
): T[] {
  return attendance.filter((row) =>
    isFreshCheckoutCandidate(row, nowMs) || activeAssignmentAttendanceIds.has(row.id)
  );
}

/**
 * Client-side prefilter for the cleanup affordance.
 *
 * This mirrors the server's fail-closed age check only to make the action
 * discoverable after a reload. The cleanup RPC remains authoritative: it
 * re-checks the row, assignments, and historical end evidence before any
 * mutation.
 */
export function staleCleanupCandidateAttendanceIds(
  attendance: CheckoutCandidateAttendance[],
  nowMs = Date.now(),
): string[] {
  return attendance
    .filter((row) => Boolean(row.id) && !isFreshCheckoutCandidate(row, nowMs))
    .map(({ id }) => id);
}

export interface DealerCheckoutBatchSummary {
  results: DealerCheckoutResult[];
  successCount: number;
  failedCount: number;
  failureMessage: string | null;
}

function safeResults(data: unknown): DealerCheckoutResult[] {
  if (!data || typeof data !== "object") return [];
  const results = (data as { results?: unknown }).results;
  return Array.isArray(results) ? results : [];
}

export function summarizeDealerCheckoutBatch(
  data: unknown,
  requestedCount: number,
): DealerCheckoutBatchSummary {
  const results = safeResults(data);
  const successful = results.filter((result) => result?.success === true);
  const explicitFailures = results.filter((result) => result?.success !== true);
  const missingCount = Math.max(0, requestedCount - results.length);
  const failedCount = explicitFailures.length + missingCount;

  if (failedCount === 0) {
    return {
      results,
      successCount: successful.length,
      failedCount: 0,
      failureMessage: null,
    };
  }

  const reasonCounts = new Map<string, number>();
  for (const result of explicitFailures) {
    const reason = typeof result.error === "string" && result.error.trim()
      ? result.error.trim()
      : "Máy chủ không trả lý do";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  if (missingCount > 0) {
    const reason = `Thiếu ${missingCount} kết quả từ máy chủ`;
    reasonCounts.set(reason, 1);
  }

  const reasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => count > 1 ? `${count}× ${reason}` : reason)
    .join("; ");

  return {
    results,
    successCount: successful.length,
    failedCount,
    failureMessage: `${failedCount} dealer thất bại — ${reasons}`,
  };
}

export function staleCleanupAttendanceIds(results: DealerCheckoutResult[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const result of results) {
    const attendanceId = result.attendance_id;
    if (
      result.success === true
      || result.code !== STALE_ATTENDANCE_REQUIRES_CLEANUP
      || typeof attendanceId !== "string"
      || !attendanceId
      || seen.has(attendanceId)
    ) continue;

    seen.add(attendanceId);
    ids.push(attendanceId);
  }

  return ids;
}

export function unresolvedCheckoutAttendanceIds(
  results: DealerCheckoutResult[],
  requestedIds: string[],
): string[] {
  const successfulIds = new Set(
    results
      .filter((result) => result.success === true && typeof result.attendance_id === "string")
      .map((result) => result.attendance_id as string),
  );

  return [...new Set(requestedIds)].filter((attendanceId) => !successfulIds.has(attendanceId));
}
