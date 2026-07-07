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
export {
  computeWeeklyAggregates,
  localWeekBounds,
  localDayStartMs,
} from "./weeklyAggregates";
export type { WeekAssignmentRow, WeeklyAggregate } from "./weeklyAggregates";
export { buildLiveScenario, requirementFromTemplates } from "./liveAdapter";
export type {
  LiveScenarioInput,
  DealerRow,
  SkillRow,
  TemplateRow,
  AvailabilityRow,
} from "./liveAdapter";
export {
  DEFAULT_SHIFT_TEMPLATE_SEEDS,
  buildTemplateSeedRows,
} from "./templateSeeds";
export { buildSaveRunPayload } from "./savePayload";
export type { SaveRunArgs, SaveRunAssignmentRow } from "./savePayload";
export {
  parseRunParams,
  buildRunParamsExtra,
  validateFinalDesignations,
  stableParamsKey,
  EMPTY_RUN_PARAMS,
} from "./runParams";
export type { ShiftRunParams, FinalDesignationIssue } from "./runParams";
export { buildScheduleSvg, svgToPngDataUrl, buildSchedulePng } from "./scheduleImage";
export type { ScheduleImageInput, ScheduleImageGroup, ScheduleImageRow } from "./scheduleImage";
export { buildWeeklyScheduleSvg, buildWeeklySchedulePng } from "./weeklyImage";
export type { WeeklyImageInput, WeeklyImageRow, WeeklyImageCell } from "./weeklyImage";
export { chipStates, ctaFor, initialStep } from "./plannerPhase";
export type { PlannerStep, ChipState, PlannerFlags, PlannerCta } from "./plannerPhase";
export {
  REJECTION_LABELS,
  REJECTION_HINTS,
  HARD_REJECTIONS,
  isHardRejection,
  fitLabel,
} from "./rejectionHints";
export { downloadDataUrl } from "./download";
