// Series Intelligence — Forward layer B.2: schedule → Monte Carlo adapter (PURE, client-only).
//
// Closes the loop: maps a GENERATED schedule (PATCH B) into the Monte Carlo engine's log-normal input
// (PATCH 3) so the owner can see an EV / Risk scenario for a drafted festival. A generated event is NOT
// observed, so its entries distribution is a HYPOTHESIS: center = the GTD-floor entries (GTD / buy_in),
// σ wide, tier 'hypothesis' → the engine's aggregate tier is always 'hypothesis' and every EV number is
// labeled accordingly. lowEntries = the GTD-floor, so the engine's `safeGTD = lowEntries × buyin`
// reproduces the schedule's GTD EXACTLY (the overlay term is the real GTD overlay). Pure — no DB, no
// simulation here (the panel calls simulateFestival); this only translates shapes.

import type { ScheduleEvent } from "./scheduleGenerator";
import type { EventLogNormal } from "./monteCarloEngine";

export const SCHEDULE_HYPOTHESIS_SIGMA = 0.6; // generated, unobserved → wide dispersion (matches engine N=1)

export interface SkippedScheduleEvent {
  name: string;
  reason: string;
}

export interface ScheduleSimMapping {
  events: EventLogNormal[];
  skipped: SkippedScheduleEvent[];
}

/**
 * Map ONE schedule event → a Monte Carlo log-normal event, or null to SKIP it (never fabricated):
 * events with no GTD/entries center (Satellite GTD=0) or a non-positive buy-in can't anchor a
 * distribution and are excluded honestly.
 */
export function scheduleEventToLogNormal(
  ev: ScheduleEvent,
  sigma: number = SCHEDULE_HYPOTHESIS_SIGMA,
): EventLogNormal | null {
  if (!(ev.buy_in_prize > 0)) return null;
  const floorEntries = ev.GTD / ev.buy_in_prize;
  if (!Number.isFinite(floorEntries) || floorEntries <= 0) return null;
  return {
    name: ev.name,
    mu: Math.log(floorEntries),
    sigma,
    fee: ev.fee_rake,
    buyin: ev.buy_in_prize,
    lowEntries: floorEntries, // ⇒ engine safeGTD = floorEntries × buyin = GTD (real overlay)
    tier: "hypothesis",
  };
}

/** Map a whole generated schedule → simulable events + the skipped (no-GTD) ones, surfaced honestly. */
export function scheduleToSimEvents(
  schedule: ScheduleEvent[],
  sigma: number = SCHEDULE_HYPOTHESIS_SIGMA,
): ScheduleSimMapping {
  const events: EventLogNormal[] = [];
  const skipped: SkippedScheduleEvent[] = [];
  for (const ev of schedule) {
    const ln = scheduleEventToLogNormal(ev, sigma);
    if (ln) events.push(ln);
    else skipped.push({ name: ev.name, reason: ev.GTD <= 0 ? "không có GTD (vd Satellite)" : "buy-in không hợp lệ" });
  }
  return { events, skipped };
}
