// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Mobile App — pure check-in window logic.
// Built on the tested `hoursBetween` from the Shift Planner core (operates on
// absolute timestamptz ms), so it is OVERNIGHT-SAFE: an 18:00→02:00 shift whose
// start straddles local midnight resolves correctly with no wrap bug. Never uses
// raw `new Date()` arithmetic on wall-clock components.
// ═══════════════════════════════════════════════════════════════════════════════

import { hoursBetween } from "@/lib/shiftPlanner";
import { CHECKIN_OPEN_BEFORE_MIN, CHECKIN_LATE_AFTER_MIN } from "./constants";
import type { CheckInPhase, CheckInState } from "@/types/dealerApp";
import type { ShiftStatus } from "@/types/shiftPlanner";

export function shiftPhase(status: ShiftStatus): CheckInPhase {
  switch (status) {
    case "checked_in":
      return "checked_in";
    case "closed":
    case "no_show":
    case "cancelled":
      return "closed";
    case "confirmed":
      return "confirmed";
    default:
      return "not_confirmed"; // draft | published
  }
}

export interface CheckInWindow {
  open: boolean;
  isLate: boolean;
  minutesUntilOpen: number; // 0 once open
  windowOpensAt: string; // ISO
}

/** Window opens `CHECKIN_OPEN_BEFORE_MIN` before start; "late" after
 *  `CHECKIN_LATE_AFTER_MIN` past start. `nowIso` is injectable for tests. */
export function checkInWindow(scheduledStartAt: string, nowIso = new Date().toISOString()): CheckInWindow {
  const minsToStart = hoursBetween(nowIso, scheduledStartAt) * 60; // >0 = start in future
  const open = minsToStart <= CHECKIN_OPEN_BEFORE_MIN;
  const isLate = -minsToStart > CHECKIN_LATE_AFTER_MIN;
  const windowOpensAt = new Date(
    Date.parse(scheduledStartAt) - CHECKIN_OPEN_BEFORE_MIN * 60_000
  ).toISOString();
  return { open, isLate, minutesUntilOpen: Math.max(0, Math.round(minsToStart - CHECKIN_OPEN_BEFORE_MIN)), windowOpensAt };
}

/** Full derived lifecycle view-state for a shift's confirm/check-in/check-out. */
export function computeCheckInState(
  status: ShiftStatus,
  scheduledStartAt: string,
  nowIso = new Date().toISOString()
): CheckInState {
  const phase = shiftPhase(status);
  const win = checkInWindow(scheduledStartAt, nowIso);
  return {
    phase,
    canConfirm: phase === "not_confirmed" && status === "published",
    canCheckIn: phase === "confirmed" && win.open,
    canCheckOut: phase === "checked_in",
    windowOpen: win.open,
    isLate: win.isLate,
    minutesUntilOpen: win.minutesUntilOpen,
    windowOpensAt: win.windowOpensAt,
  };
}
