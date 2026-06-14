// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner — weekly aggregates (overlap-based, cross-midnight aware)
// ═══════════════════════════════════════════════════════════════════════════════
// Computes per-dealer week-to-date context the scheduler needs, by TIMESTAMPTZ
// OVERLAP with the local week — NOT by filtering work_date (which would mis-count
// 18–02 / 00–08 shifts that straddle the week boundary).

import { isNightShift } from "./time";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface WeekAssignmentRow {
  dealerId: string;
  scheduledStartAt: string; // ISO timestamptz
  scheduledEndAt: string; // ISO timestamptz (may be next calendar day)
}

export interface WeeklyAggregate {
  assignedHoursThisWeek: number;
  nightShiftsThisWeek: number;
  lastShiftEndAt: string | null;
}

function offsetStr(tzOffsetMinutes: number): string {
  const sign = tzOffsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(tzOffsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** UTC ms of local midnight of `workDate` (YYYY-MM-DD) in the club tz. */
export function localDayStartMs(workDate: string, tzOffsetMinutes: number): number {
  return Date.parse(`${workDate}T00:00:00${offsetStr(tzOffsetMinutes)}`);
}

/** [Mon 00:00, next Mon 00:00) local week bounds (UTC ms) containing `workDate`. */
export function localWeekBounds(
  workDate: string,
  tzOffsetMinutes: number
): { startMs: number; endMs: number } {
  const dayStart = localDayStartMs(workDate, tzOffsetMinutes);
  const dow = new Date(dayStart + tzOffsetMinutes * 60_000).getUTCDay(); // 0=Sun..6=Sat
  const mondayIdx = (dow + 6) % 7; // 0=Mon
  const startMs = dayStart - mondayIdx * DAY_MS;
  return { startMs, endMs: startMs + 7 * DAY_MS };
}

export function computeWeeklyAggregates(
  assignments: WeekAssignmentRow[],
  workDate: string,
  tzOffsetMinutes: number
): Record<string, WeeklyAggregate> {
  const { startMs, endMs } = localWeekBounds(workDate, tzOffsetMinutes);
  const dayStart = localDayStartMs(workDate, tzOffsetMinutes);
  const agg: Record<string, WeeklyAggregate> = {};
  const ensure = (id: string) =>
    (agg[id] ??= { assignedHoursThisWeek: 0, nightShiftsThisWeek: 0, lastShiftEndAt: null });

  for (const a of assignments) {
    const as = Date.parse(a.scheduledStartAt);
    let ae = Date.parse(a.scheduledEndAt);
    if (ae <= as) ae += DAY_MS; // defensive: same-date end stored earlier than start
    const row = ensure(a.dealerId);

    // Hours = overlap of [as, ae) with the local week [startMs, endMs).
    const overlap = Math.max(0, Math.min(ae, endMs) - Math.max(as, startMs));
    row.assignedHoursThisWeek += overlap / HOUR_MS;

    // Night shift if it STARTS within the week and qualifies (≥18:00 / 00–06 / wrap).
    if (as >= startMs && as < endMs && isNightShift(a.scheduledStartAt, a.scheduledEndAt, tzOffsetMinutes)) {
      row.nightShiftsThisWeek += 1;
    }

    // Most recent shift ending before the planned day → drives rest-between-days.
    if (ae <= dayStart) {
      const prev = row.lastShiftEndAt ? Date.parse(row.lastShiftEndAt) : -Infinity;
      if (ae > prev) row.lastShiftEndAt = new Date(ae).toISOString();
    }
  }
  return agg;
}
