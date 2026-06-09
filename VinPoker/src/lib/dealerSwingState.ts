export type PreAssignStatus = "valid" | "in_progress" | "stale" | "expired" | "none";

export interface DealerAssignmentStateLike {
  pre_assigned_attendance_id: string | null;
  pre_assigned_at?: string | null;
  swing_in_progress?: boolean | null;
  updated_at?: string | null;
  last_swing_attempted_at?: string | null;
  released_at?: string | null;
  swing_processed_at?: string | null;
  status?: string | null;
  swing_due_at?: string | null;
}

export interface Pass3CandidateLike extends DealerAssignmentStateLike {
  id: string;
  table_id: string;
  swing_due_at: string;
  overtime_started_at?: string | null;
}

export const ZOMBIE_LOCK_WINDOW_MS = 2 * 60_000;
export const DEFAULT_PRE_ASSIGN_STALE_WINDOW_MS = 15 * 60_000;

const parseMillis = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const getActivityMs = (row: DealerAssignmentStateLike): number | null => {
  const candidates = [
    parseMillis(row.updated_at),
    parseMillis(row.last_swing_attempted_at),
  ].filter((value): value is number => value !== null);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
};

export function isFreshInProgress(
  row: DealerAssignmentStateLike,
  nowMs = Date.now(),
  freshnessWindowMs = ZOMBIE_LOCK_WINDOW_MS,
): boolean {
  if (!row.swing_in_progress) return false;
  const activityMs = getActivityMs(row);
  if (activityMs === null) return false;
  return nowMs - activityMs <= freshnessWindowMs;
}

export function derivePreAssignStatus(
  row: DealerAssignmentStateLike,
  nowMs = Date.now(),
  options?: { staleWindowMs?: number; freshnessWindowMs?: number },
): PreAssignStatus {
  if (!row.pre_assigned_attendance_id) return "none";

  if (row.released_at || row.swing_processed_at || (row.status && row.status !== "assigned")) {
    return "expired";
  }

  const freshnessWindowMs = options?.freshnessWindowMs ?? ZOMBIE_LOCK_WINDOW_MS;
  if (isFreshInProgress(row, nowMs, freshnessWindowMs)) {
    return "in_progress";
  }

  if (row.swing_in_progress) {
    return "expired";
  }

  const staleWindowMs = options?.staleWindowMs ?? DEFAULT_PRE_ASSIGN_STALE_WINDOW_MS;
  const dueMs = parseMillis(row.swing_due_at);
  if (dueMs !== null && nowMs >= dueMs) {
    return "stale";
  }

  const preAssignedAtMs = parseMillis(row.pre_assigned_at);
  if (preAssignedAtMs !== null && nowMs - preAssignedAtMs > staleWindowMs) {
    return "stale";
  }

  const activityMs = getActivityMs(row);
  if (activityMs !== null && nowMs - activityMs > staleWindowMs) {
    return "stale";
  }

  return "valid";
}

export function getPreAssignStatusLabel(status: PreAssignStatus): string | null {
  switch (status) {
    case "in_progress":
      return "Đang chuyển";
    case "stale":
      return "Quá hạn (chờ vào)";
    case "expired":
      return "Hết hạn";
    default:
      return null;
  }
}

export function comparePass3Candidates(a: Pass3CandidateLike, b: Pass3CandidateLike): number {
  const aBucket = a.pre_assigned_attendance_id ? 0 : a.overtime_started_at ? 2 : 1;
  const bBucket = b.pre_assigned_attendance_id ? 0 : b.overtime_started_at ? 2 : 1;
  if (aBucket !== bBucket) return aBucket - bBucket;

  const aDue = parseMillis(a.swing_due_at) ?? 0;
  const bDue = parseMillis(b.swing_due_at) ?? 0;
  if (aDue !== bDue) return aDue - bDue;

  const aActivity = getActivityMs(a) ?? 0;
  const bActivity = getActivityMs(b) ?? 0;
  if (aActivity !== bActivity) return aActivity - bActivity;

  return a.table_id.localeCompare(b.table_id);
}

export function sortPass3Candidates<T extends Pass3CandidateLike>(rows: readonly T[]): T[] {
  return [...rows].sort(comparePass3Candidates);
}

export interface AssignmentShadowLike extends DealerAssignmentStateLike {
  assigned_at: string;
  released_at: string | null;
  swing_processed_at: string | null;
  updated_at: string;
  version: number;
}

export function pickPreferredAssignment<T extends AssignmentShadowLike>(
  current: T | undefined,
  candidate: T,
  nowMs = Date.now(),
): T {
  if (!current) return candidate;

  const currentProcessed = current.swing_processed_at ? 1 : 0;
  const candidateProcessed = candidate.swing_processed_at ? 1 : 0;
  if (currentProcessed !== candidateProcessed) {
    return candidateProcessed < currentProcessed ? candidate : current;
  }

  const currentReleased = current.released_at ? 1 : 0;
  const candidateReleased = candidate.released_at ? 1 : 0;
  if (currentReleased !== candidateReleased) {
    return candidateReleased < currentReleased ? candidate : current;
  }

  const currentFreshInProgress = isFreshInProgress(current, nowMs) ? 1 : 0;
  const candidateFreshInProgress = isFreshInProgress(candidate, nowMs) ? 1 : 0;
  if (currentFreshInProgress !== candidateFreshInProgress) {
    return candidateFreshInProgress > currentFreshInProgress ? candidate : current;
  }

  const currentActivity = getActivityMs(current) ?? parseMillis(current.updated_at) ?? 0;
  const candidateActivity = getActivityMs(candidate) ?? parseMillis(candidate.updated_at) ?? 0;
  if (candidateActivity !== currentActivity) {
    return candidateActivity > currentActivity ? candidate : current;
  }

  return (candidate.version ?? 0) >= (current.version ?? 0) ? candidate : current;
}
