import { DEALER_TZ_OFFSET_MINUTES } from "./constants";

/** Club-local "today" as YYYY-MM-DD. App-runtime only (reads Date.now); pure
 *  selectors take explicit dates so they stay test-deterministic. */
export function localTodayDate(tzOffsetMinutes = DEALER_TZ_OFFSET_MINUTES): string {
  return new Date(Date.now() + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD date by `days` (club-local), returning YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00+07:00`) + days * 86_400_000;
  return new Date(ms + DEALER_TZ_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}
