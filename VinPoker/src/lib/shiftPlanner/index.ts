// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner — pure core barrel
// ═══════════════════════════════════════════════════════════════════════════════

export {
  generateDailyDraft,
  hardRejectReasons,
  scoreDealerForSlot,
  buildWeeklyHoursMap,
  SOLVER_VERSION,
} from "./generateDailyDraft";
export type { CandidateScore } from "./generateDailyDraft";
export { computeCoverageByHour, coverageSeverity } from "./coverage";
export {
  shiftDurationHours,
  hoursBetween,
  startHourLocal,
  localDayIndex,
  crossesMidnight,
  overlaps,
  eachCoveredHour,
  isNightShift,
} from "./time";
export { buildMockScenario } from "./mockData";
export type { MockScenario } from "./mockData";
