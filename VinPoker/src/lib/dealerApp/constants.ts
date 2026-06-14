// Dealer Mobile App — shared constants. Planner-layer only; never swing/payroll.

/** Minutes to add to UTC for club-local wall time (VN = +420). Single source of
 *  truth, matching useShiftPlanner's CLUB_TZ_OFFSET_MINUTES. Per-club config later. */
export const DEALER_TZ_OFFSET_MINUTES = 420;

/** Roster check-in window opens this many minutes before the scheduled start. */
export const CHECKIN_OPEN_BEFORE_MIN = 30;

/** A check-in is flagged "late" once this many minutes past the scheduled start. */
export const CHECKIN_LATE_AFTER_MIN = 10;

/** Default weekly target hours shown on the week summary. */
export const WEEKLY_TARGET_HOURS = 40;

/** Gold accent reserved for shift/earnings emphasis (hybrid Stitch theme). The
 *  app base stays neon-green (--primary); gold is a focused accent only. */
export const DEALER_GOLD = "#E6B84C";
