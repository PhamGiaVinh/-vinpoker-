// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Mobile App — pure selectors (time labels, week cells, week summary).
// Reuses the Shift Planner core (shiftDurationHours / isNightShift / crossesMidnight
// / computeWeeklyAggregates / localWeekBounds) — the overnight + weekly-overlap math
// is already unit-tested there. No raw wall-clock arithmetic here.
// ═══════════════════════════════════════════════════════════════════════════════

import {
  shiftDurationHours,
  isNightShift,
  crossesMidnight,
  computeWeeklyAggregates,
  localWeekBounds,
} from "@/lib/shiftPlanner";
import { DEALER_TZ_OFFSET_MINUTES, WEEKLY_TARGET_HOURS } from "./constants";
import type { DealerShiftView, WeekDayCell, WeekSummaryView } from "@/types/dealerApp";

const DAY_MS = 86_400_000;
const TZ = DEALER_TZ_OFFSET_MINUTES;
type TimeRange = Pick<DealerShiftView, "scheduledStartAt" | "scheduledEndAt">;

function hhmm(iso: string): string {
  const d = new Date(Date.parse(iso) + TZ * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Club-local "HH:MM" for an ISO instant. */
export function formatHm(iso: string): string {
  return hhmm(iso);
}

export function shiftTimeLabel(s: TimeRange): string {
  return `${hhmm(s.scheduledStartAt)} – ${hhmm(s.scheduledEndAt)}`;
}

/**
 * Scheduled-pool display (FEATURES.dealerPoolBridge only). Once a dealer is checked
 * in, they join the rotation pool at `greatest(scheduledStart, arrival)` — early
 * arrival is "pending" (đã có mặt, chờ vào ca) until the scheduled start. Mirrors the
 * server rule in `_dealer_record_checkin`. Pure; `nowIso` injectable for tests.
 */
export function poolEntryInfo(
  s: Pick<DealerShiftView, "scheduledStartAt" | "checkedInAt" | "status">,
  nowIso: string
): { poolEntryAt: string; pending: boolean } {
  const arrival = s.checkedInAt ?? nowIso;
  const poolEntryAt = Date.parse(arrival) > Date.parse(s.scheduledStartAt) ? arrival : s.scheduledStartAt;
  const pending = s.status === "checked_in" && Date.parse(nowIso) < Date.parse(poolEntryAt);
  return { poolEntryAt, pending };
}

export function shiftHours(s: TimeRange): number {
  return Math.round(shiftDurationHours(s.scheduledStartAt, s.scheduledEndAt) * 10) / 10;
}

export function isOvernightShift(s: TimeRange): boolean {
  return crossesMidnight(s.scheduledStartAt, s.scheduledEndAt, TZ);
}

export function isNight(s: TimeRange): boolean {
  return isNightShift(s.scheduledStartAt, s.scheduledEndAt, TZ);
}

/** The 7 club-local dates (Mon..Sun) of the week containing `anchorDate`. */
export function weekDates(anchorDate: string): string[] {
  const { startMs } = localWeekBounds(anchorDate, TZ);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(startMs + i * DAY_MS + TZ * 60_000).toISOString().slice(0, 10)
  );
}

const isLive = (s: DealerShiftView) => s.status !== "cancelled" && s.status !== "no_show";

export function buildWeekCells(shifts: DealerShiftView[], dates: string[], today: string): WeekDayCell[] {
  const byDate = new Map<string, DealerShiftView>();
  for (const s of shifts) if (isLive(s)) byDate.set(s.workDate, s);
  return dates.map((date) => {
    const shift = byDate.get(date) ?? null;
    const isToday = date === today;
    if (!shift) {
      return { date, isToday, kind: "off", shift: null, label: "", isNight: false, isOvernight: false };
    }
    const kind: WeekDayCell["kind"] = shift.role === "OnCall" ? "on_call" : "shift";
    return {
      date,
      isToday,
      kind,
      shift,
      label: shiftTimeLabel(shift),
      isNight: isNight(shift),
      isOvernight: isOvernightShift(shift),
    };
  });
}

export function weekSummary(
  shifts: DealerShiftView[],
  anchorDate: string,
  target = WEEKLY_TARGET_HOURS
): WeekSummaryView {
  const rows = shifts.filter(isLive).map((s) => ({
    dealerId: s.dealerId,
    scheduledStartAt: s.scheduledStartAt,
    scheduledEndAt: s.scheduledEndAt,
  }));
  const agg =
    Object.values(computeWeeklyAggregates(rows, anchorDate, TZ))[0] ?? {
      assignedHoursThisWeek: 0,
      nightShiftsThisWeek: 0,
      lastShiftEndAt: null,
    };
  const { startMs } = localWeekBounds(anchorDate, TZ);
  return {
    weekStart: new Date(startMs + TZ * 60_000).toISOString().slice(0, 10),
    totalHours: Math.round(agg.assignedHoursThisWeek * 10) / 10,
    targetHours: target,
    nightShifts: agg.nightShiftsThisWeek,
    daysWorked: rows.length,
  };
}
