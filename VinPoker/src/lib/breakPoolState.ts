export const BREAK_SOON_WARNING_MINUTES = 2;
export const DEFAULT_BREAK_DURATION_MINUTES = 10;

// Open-table warmup: when a dealer is assigned to open/staff a table, a
// OPEN_TABLE_GRACE_MINUTES "warmup" runs before the swing clock starts counting.
// MUST match the edge-function constant in supabase/functions/_shared/openTableGrace.ts.
export const OPEN_TABLE_GRACE_MINUTES = 6;

/** Per-club inter-swing rest minutes (max across table-types) — mirrors useBreakPool. */
export function buildRestMinutesByClub(
  swingConfigs: { club_id: string; min_inter_swing_rest_minutes?: number | null }[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const c of swingConfigs) {
    const m = c.min_inter_swing_rest_minutes;
    if (m != null && m > 0) map[c.club_id] = Math.max(map[c.club_id] ?? 0, m);
  }
  return map;
}

/**
 * Manual-assign eligibility for the "Gán dealer" dropdown. A dealer may be
 * assigned to open/staff a table only when they are NOT currently dealing or
 * spoken-for AND have rested enough:
 *  - state must be 'available' or 'on_break' (excludes 'assigned' / 'in_transition'
 *    = currently dealing, and 'pre_assigned' / 'checked_out');
 *  - rested enough = no last_released_at, or (now − last_released_at) ≥ the club's
 *    min_inter_swing_rest_minutes. This covers both an available dealer still in the
 *    inter-swing cooldown and an on-break dealer who hasn't completed minimum rest.
 * Mirrors the backend pickNextDealer rest gate so manual + auto stay consistent.
 */
export function isAssignableDealer(
  dealer: { current_state: string | null; last_released_at: string | null; clubId: string | null },
  restMinutesByClub: Record<string, number>,
  nowMs: number,
): boolean {
  if (dealer.current_state !== "available" && dealer.current_state !== "on_break") return false;
  if (!dealer.last_released_at) return true;
  const restMin = dealer.clubId ? (restMinutesByClub[dealer.clubId] ?? 0) : 0;
  if (restMin <= 0) return true;
  const releasedMs = new Date(dealer.last_released_at).getTime();
  if (!Number.isFinite(releasedMs)) return true;
  return nowMs - releasedMs >= restMin * 60_000;
}

export type BreakType = "regular" | "meal" | "rest";
export type BreakVisualState = "active" | "soon" | "overdue";

export interface BreakPoolDealerSource {
  attendanceId: string;
  dealerId: string;
  clubId: string | null;
  fullName: string;
  telegramUsername: string | null;
  tier: "A" | "B" | "C" | null;
  checkInTime: string | null;
  currentState: string | null;
}

export interface RegularBreakAssignmentSource {
  assignmentId: string;
  attendanceId: string;
  releasedAt: string | null;
  tableName: string | null;
}

export interface RegularBreakSource {
  id: string;
  assignmentId: string | null;
  attendanceId?: string | null;
  breakStart: string;
  expectedDurationMinutes: number | null;
  reason: string | null;
}

export interface MealBreakSource {
  id: string;
  attendanceId: string;
  breakStart: string;
  totalDurationMinutes: number;
  baseDurationMinutes: number | null;
  bonusMinutes: number | null;
}

export interface BreakPoolEntry {
  id: string;
  attendanceId: string;
  dealerId: string;
  clubId: string | null;
  dealerName: string;
  telegramUsername: string | null;
  tier: "A" | "B" | "C" | null;
  breakType: BreakType;
  tableName: string | null;
  breakStartAt: string;
  expectedReturnAt: string;
  durationMinutes: number;
  isFallback: boolean;
}

interface BuildBreakPoolEntriesOptions {
  dealers: BreakPoolDealerSource[];
  regularAssignments: RegularBreakAssignmentSource[];
  regularBreaks: RegularBreakSource[];
  mealBreaks: MealBreakSource[];
  defaultBreakMinutesByClubId?: Record<string, number>;
  nowMs?: number;
}

export function toMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

function pickLatestAssignment(
  current: RegularBreakAssignmentSource | undefined,
  candidate: RegularBreakAssignmentSource,
): RegularBreakAssignmentSource {
  if (!current) return candidate;
  const currentMs = toMs(current.releasedAt);
  const candidateMs = toMs(candidate.releasedAt);
  if (candidateMs !== currentMs) return candidateMs > currentMs ? candidate : current;
  return candidate.assignmentId.localeCompare(current.assignmentId) > 0 ? candidate : current;
}

function pickLatestMealBreak(
  current: MealBreakSource | undefined,
  candidate: MealBreakSource,
): MealBreakSource {
  if (!current) return candidate;
  const currentMs = toMs(current.breakStart);
  const candidateMs = toMs(candidate.breakStart);
  if (candidateMs !== currentMs) return candidateMs > currentMs ? candidate : current;
  return candidate.id.localeCompare(current.id) > 0 ? candidate : current;
}

function pickLatestRegularBreak(
  current: RegularBreakSource | undefined,
  candidate: RegularBreakSource,
): RegularBreakSource {
  if (!current) return candidate;
  const currentMs = toMs(current.breakStart);
  const candidateMs = toMs(candidate.breakStart);
  if (candidateMs !== currentMs) return candidateMs > currentMs ? candidate : current;
  return candidate.id.localeCompare(current.id) > 0 ? candidate : current;
}

export function sortBreakPoolEntries(entries: BreakPoolEntry[]): BreakPoolEntry[] {
  return [...entries].sort((a, b) => {
    const startDiff = toMs(a.breakStartAt) - toMs(b.breakStartAt);
    if (startDiff !== 0) return startDiff;
    const typeDiff = a.breakType.localeCompare(b.breakType);
    if (typeDiff !== 0) return typeDiff;
    const nameDiff = a.dealerName.localeCompare(b.dealerName);
    if (nameDiff !== 0) return nameDiff;
    return a.id.localeCompare(b.id);
  });
}

export function getBreakTiming(entry: BreakPoolEntry, nowMs: number) {
  const startMs = toMs(entry.breakStartAt);
  const returnMs = toMs(entry.expectedReturnAt);
  const elapsedMs = Math.max(0, nowMs - startMs);
  const remainingMs = returnMs - nowMs;

  return {
    elapsedMinutes: Math.max(0, Math.floor(elapsedMs / 60_000)),
    remainingMinutes: remainingMs > 0 ? Math.ceil(remainingMs / 60_000) : 0,
    overdueMinutes: remainingMs < 0 ? Math.ceil(Math.abs(remainingMs) / 60_000) : 0,
  };
}

export function getBreakVisualState(
  entry: BreakPoolEntry,
  nowMs: number,
  warningMinutes = BREAK_SOON_WARNING_MINUTES,
): BreakVisualState {
  const returnMs = toMs(entry.expectedReturnAt);
  if (returnMs <= nowMs) return "overdue";
  if ((returnMs - nowMs) / 60_000 <= warningMinutes) return "soon";
  return "active";
}

export function buildBreakPoolEntries({
  dealers,
  regularAssignments,
  regularBreaks,
  mealBreaks,
  defaultBreakMinutesByClubId = {},
  nowMs = Date.now(),
}: BuildBreakPoolEntriesOptions): BreakPoolEntry[] {
  const assignmentByAttendance = new Map<string, RegularBreakAssignmentSource>();
  for (const assignment of regularAssignments) {
    assignmentByAttendance.set(
      assignment.attendanceId,
      pickLatestAssignment(assignmentByAttendance.get(assignment.attendanceId), assignment),
    );
  }

  const regularBreakByAssignment = new Map<string, RegularBreakSource>();
  const regularBreakByAttendance = new Map<string, RegularBreakSource>();
  for (const breakRow of regularBreaks) {
    if (breakRow.assignmentId) {
      regularBreakByAssignment.set(
        breakRow.assignmentId,
        pickLatestRegularBreak(regularBreakByAssignment.get(breakRow.assignmentId), breakRow),
      );
    }
    if (breakRow.attendanceId) {
      regularBreakByAttendance.set(
        breakRow.attendanceId,
        pickLatestRegularBreak(regularBreakByAttendance.get(breakRow.attendanceId), breakRow),
      );
    }
  }

  const mealBreakByAttendance = new Map<string, MealBreakSource>();
  for (const mealBreak of mealBreaks) {
    mealBreakByAttendance.set(
      mealBreak.attendanceId,
      pickLatestMealBreak(mealBreakByAttendance.get(mealBreak.attendanceId), mealBreak),
    );
  }

  const entries: BreakPoolEntry[] = [];
  for (const dealer of dealers) {
    if (dealer.currentState !== "on_break") continue;

    const fallbackDuration =
      (dealer.clubId ? defaultBreakMinutesByClubId[dealer.clubId] : undefined) ??
      DEFAULT_BREAK_DURATION_MINUTES;
    const mealBreak = mealBreakByAttendance.get(dealer.attendanceId);
    if (mealBreak) {
      const expectedReturnAt = isoFromMs(
        toMs(mealBreak.breakStart) + mealBreak.totalDurationMinutes * 60_000,
      );
      entries.push({
        id: `meal:${mealBreak.id}`,
        attendanceId: dealer.attendanceId,
        dealerId: dealer.dealerId,
        clubId: dealer.clubId,
        dealerName: dealer.fullName,
        telegramUsername: dealer.telegramUsername,
        tier: dealer.tier,
        breakType: "meal",
        tableName: null,
        breakStartAt: mealBreak.breakStart,
        expectedReturnAt,
        durationMinutes: mealBreak.totalDurationMinutes,
        isFallback: false,
      });
      continue;
    }

    const assignment = assignmentByAttendance.get(dealer.attendanceId);
    const regularBreak = assignment
      ? regularBreakByAttendance.get(dealer.attendanceId) ?? regularBreakByAssignment.get(assignment.assignmentId)
      : regularBreakByAttendance.get(dealer.attendanceId);
    const breakStartMs =
      toMs(regularBreak?.breakStart) ||
      toMs(assignment?.releasedAt) ||
      toMs(dealer.checkInTime) ||
      nowMs;
    const durationMinutes = regularBreak?.expectedDurationMinutes ?? fallbackDuration;
    entries.push({
      id: `regular:${regularBreak?.id ?? assignment?.assignmentId ?? dealer.attendanceId}`,
      attendanceId: dealer.attendanceId,
      dealerId: dealer.dealerId,
      clubId: dealer.clubId,
      dealerName: dealer.fullName,
      telegramUsername: dealer.telegramUsername,
      tier: dealer.tier,
      breakType: "regular",
      tableName: assignment?.tableName ?? null,
      breakStartAt: isoFromMs(breakStartMs),
      expectedReturnAt: isoFromMs(breakStartMs + durationMinutes * 60_000),
      durationMinutes,
      isFallback: !regularBreak,
    });
  }

  return sortBreakPoolEntries(entries);
}
