// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner — pure time helpers (cross-midnight aware)
// ═══════════════════════════════════════════════════════════════════════════════
// No timezone library: callers pass tzOffsetMinutes (VN = +420). All inputs are
// ISO timestamptz strings; Date.parse handles the embedded offset, so arithmetic
// is on absolute UTC milliseconds and is correct across midnight / DST-free zones.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Absolute end ms, normalising the "end clock earlier than start" case
 *  (e.g. 18:00 → 02:00 stored same-date) by rolling forward one day. */
function endMs(startAt: string, endAt: string): number {
  const start = Date.parse(startAt);
  let end = Date.parse(endAt);
  if (end <= start) end += DAY_MS;
  return end;
}

/** Shift length in hours; 18–02, 16–00, 00–08 → 8. */
export function shiftDurationHours(startAt: string, endAt: string): number {
  return (endMs(startAt, endAt) - Date.parse(startAt)) / HOUR_MS;
}

/** Hours between two instants (b − a). Negative if b precedes a. */
export function hoursBetween(aIso: string, bIso: string): number {
  return (Date.parse(bIso) - Date.parse(aIso)) / HOUR_MS;
}

/** Local hour-of-day (0–23) for an instant, given the club tz offset. */
export function startHourLocal(iso: string, tzOffsetMinutes: number): number {
  return new Date(Date.parse(iso) + tzOffsetMinutes * 60_000).getUTCHours();
}

/** Local calendar-day index (days since epoch in club-local time). */
export function localDayIndex(iso: string, tzOffsetMinutes: number): number {
  return Math.floor((Date.parse(iso) + tzOffsetMinutes * 60_000) / DAY_MS);
}

/** True when the shift's local end day differs from its local start day. */
export function crossesMidnight(startAt: string, endAt: string, tzOffsetMinutes: number): boolean {
  const start = Date.parse(startAt);
  let end = Date.parse(endAt);
  if (end <= start) end += DAY_MS;
  return (
    localDayIndex(new Date(end).toISOString(), tzOffsetMinutes) !==
    localDayIndex(startAt, tzOffsetMinutes)
  );
}

/** Do two windows overlap on the absolute timeline? */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = Date.parse(aStart);
  const ae = endMs(aStart, aEnd);
  const bs = Date.parse(bStart);
  const be = endMs(bStart, bEnd);
  return as < be && bs < ae;
}

/** Every local hour-of-day bucket (0–23) the shift covers, wrapping midnight.
 *  18–02 → [18,19,20,21,22,23,0,1]. Drives coverage-by-hour. */
export function eachCoveredHour(startAt: string, endAt: string, tzOffsetMinutes: number): number[] {
  const startLocalMs = Date.parse(startAt) + tzOffsetMinutes * 60_000;
  const endLocalMs = endMs(startAt, endAt) + tzOffsetMinutes * 60_000;
  const firstHour = Math.floor(startLocalMs / HOUR_MS);
  const lastHour = Math.ceil(endLocalMs / HOUR_MS);
  const hours: number[] = [];
  for (let h = firstHour; h < lastHour; h++) {
    hours.push(((h % 24) + 24) % 24);
  }
  return hours;
}

/** A shift counts as "night" if it starts late (≥22:00), starts early (<06:00),
 *  or crosses midnight. */
export function isNightShift(startAt: string, endAt: string, tzOffsetMinutes: number): boolean {
  const sh = startHourLocal(startAt, tzOffsetMinutes);
  return sh >= 22 || sh < 6 || crossesMidnight(startAt, endAt, tzOffsetMinutes);
}
