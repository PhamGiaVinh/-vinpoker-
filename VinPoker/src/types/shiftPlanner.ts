// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner V2.1 — shared types
// ═══════════════════════════════════════════════════════════════════════════════
// Staff-scheduling module (schedule dealers per day/week with flexible check-in
// times). SEPARATE from the live Dealer Swing rotation system — these types never
// touch dealer_assignments / dealer_attendance / dealer_rotation_schedule / swing_*.
//
// Consumed by: src/lib/shiftPlanner/* (pure core), src/hooks/useShiftPlanner.ts,
// and the ShiftPlannerTab UI.

export type ShiftStatus =
  | "draft"
  | "published"
  | "confirmed"
  | "checked_in"
  | "closed"
  | "cancelled"
  | "no_show";

export type AvailabilityKind = "preferred" | "available" | "leave" | "unavailable";

/** Where the planner reads its inputs from. mock = in-memory seed (Phase 1,
 *  demoable with no DB); live = read dealers/dealer_skills/clubs (Phase 2). */
export type ShiftPlannerDataSource = "mock" | "live";

/** Dealer seniority. Mirrors the live `dealers.tier` text column (A | B | C). */
export type DealerTier = "A" | "B" | "C";

export type DealerRole = "Dealer" | "Lead";

// ── Inputs ────────────────────────────────────────────────────────────────────

/** An open shift slot to fill on a given work day. Real start/end timestamps so
 *  flexible windows (08–16, 16–00, 18–02, 00–08…) and cross-midnight shifts work. */
export interface ShiftTemplate {
  id: string;
  clubId: string;
  /** Short human label, e.g. "08–16". */
  label: string;
  /** ISO timestamptz of the shift start on the work date. */
  startAt: string;
  /** ISO timestamptz of the shift end (may be on the next calendar day). */
  endAt: string;
  /** Nominal length (informational; real length derived from start/end). */
  defaultHours: number;
  /** Skills a dealer must have ≥1 of. Empty = no skill requirement. */
  requiredSkills: string[];
  /** Slot needs a Lead/senior dealer. */
  needsLead: boolean;
  /** How many dealers this slot needs. */
  needCount: number;
}

/** A schedulable dealer, projected from `dealers` (+ `dealer_skills`) plus the
 *  week-to-date context the scheduler needs. Pure-core input only. */
export interface SchedulerDealer {
  id: string;
  clubId: string;
  fullName: string;
  tier: DealerTier;
  /** Derived (tier A) — may also be set explicitly by the live adapter. */
  isLead: boolean;
  /** 'active' | 'inactive' | 'on_leave' (from dealers.status). */
  status: string;
  /** Skill tags, merged from dealers.skills[] + dealer_skills.game_type. */
  skills: string[];
  /** Hours already scheduled Mon..(work date) for the current week. */
  assignedHoursThisWeek: number;
  maxHoursPerWeek: number;
  weeklyTargetHours: number;
  /** Night shifts already scheduled this week (for fairness). */
  nightShiftsThisWeek: number;
  /** Start-time history: "HH:MM" → count of past shifts started then. */
  preferredStartHours: Record<string, number>;
  /** ISO end of the dealer's previous shift, for rest-between-days check. */
  lastShiftEndAt?: string | null;
  /** Whole dates the dealer is unavailable (YYYY-MM-DD). */
  unavailableDates?: string[];
  /** Auto-fill window preference: 'som' | 'muon' | 'linh_hoat'. null/undefined =
   *  flexible. Only scored when config.applyShiftPreference is on. */
  shiftPreference?: string | null;
}

/** A dealer's availability/wishes for one work date (grouped from
 *  dealer_availability_requests rows). */
export interface AvailabilityRequest {
  dealerId: string;
  workDate: string; // YYYY-MM-DD
  preferredTemplateIds: string[];
  availableTemplateIds: string[];
  unavailableTemplateIds: string[];
  leaveRequested?: boolean;
  note?: string;
  /** Review status of the dealer's request: submitted (pending) | acknowledged |
   *  rejected. Undefined for mock/legacy. 'submitted' → floor still needs to act. */
  status?: string;
}

export interface SchedulerConfig {
  weeklyTargetHours: number;
  weeklyMaxHours: number;
  /** Minimum rest (hours) between a dealer's previous shift end and a new start. */
  minRestHours: number;
  maxNightShiftsPerWeek: number;
  /** Minutes to add to UTC to get club-local wall time (VN = +420). */
  tzOffsetMinutes: number;
  /** Required dealers per local hour-of-day (0–23). */
  requirementByHour: Record<number, number>;
  /** When true, dealer.shiftPreference contributes to the soft score (auto-fill
   *  Patch 3). Off/undefined → no preference scoring (V1 + legacy behaviour). */
  applyShiftPreference?: boolean;
}

// ── Outputs ───────────────────────────────────────────────────────────────────

export interface ScoreComponent {
  label: string;
  points: number;
}

export interface DraftAssignment {
  templateId: string;
  templateLabel: string;
  dealerId: string;
  dealerName: string;
  workDate: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  durationHours: number;
  role: DealerRole;
  status: ShiftStatus;
  score: number;
  scoreBreakdown: ScoreComponent[];
  reasons: string[];
  isNightShift: boolean;
  /** Dealer was pinned by the floor to "chia final" for this window (auto-fill Patch 3). */
  finalDesignated?: boolean;
}

export type RejectionReason =
  | "already_assigned_same_day"
  | "on_leave"
  | "marked_unavailable"
  | "missing_required_skill"
  | "exceeds_weekly_max_hours"
  | "insufficient_rest"
  | "needs_lead"
  | "inactive";

export interface RejectionRecord {
  dealerId: string;
  dealerName: string;
  templateId: string;
  templateLabel: string;
  reason: RejectionReason;
  detail: string;
}

export interface UnfilledSlot {
  templateId: string;
  templateLabel: string;
  missing: number;
  detail: string;
}

/** A floor-designated "chia final" dealer who could NOT be pinned (on leave,
 *  already assigned, inactive…). The seat is still filled by a regular dealer —
 *  only the designation is short. Auto-fill Patch 3; never auto-substituted. */
export interface FinalShortage {
  templateId: string;
  templateLabel: string;
  dealerId: string;
  dealerName: string;
  reason: RejectionReason;
  detail: string;
}

export type WarningKind =
  | "coverage_gap"
  | "low_score"
  | "night_overload"
  | "near_weekly_limit";

export interface SchedulerWarning {
  kind: WarningKind;
  detail: string;
}

export interface CoverageBucket {
  hour: number; // 0–23 local
  required: number;
  assigned: number;
  /** required − assigned. >0 = short. */
  deficit: number;
  status: "under" | "ok" | "over";
}

export interface ScheduleRunMeta {
  solverVersion: string;
  generatedAt: string;
  workDate: string;
}

export interface GenerateDailyDraftResult {
  assignments: DraftAssignment[];
  unfilled: UnfilledSlot[];
  rejections: RejectionRecord[];
  coverage: CoverageBucket[];
  warnings: SchedulerWarning[];
  runMeta: ScheduleRunMeta;
  /** Floor "chia final" designees that couldn't be pinned (auto-fill Patch 3).
   *  Always present ([] when none / feature unused). */
  finalShortages?: FinalShortage[];
}

export interface GenerateDailyDraftInput {
  workDate: string; // YYYY-MM-DD, club-local
  clubId: string;
  dealers: SchedulerDealer[];
  templates: ShiftTemplate[];
  availability: AvailabilityRequest[];
  config: SchedulerConfig;
  /** Optional fixed "now" for deterministic runMeta (tests). */
  nowIso?: string;
  /** Per-template dealers the floor pinned to "chia final" (auto-fill Patch 3).
   *  Pinned before the regular fill; an ineligible designee → finalShortages,
   *  never auto-substituted. Absent → no pinning (V1/legacy behaviour). */
  finalDesignations?: Record<string, string[]>;
  /** Assignments to KEEP as-is (manual edits / a prior run) — they seed the used
   *  set and per-template fill counts so the solver only fills the gap and never
   *  duplicates. Absent → fill from scratch (V1/legacy behaviour). */
  keepAssignments?: DraftAssignment[];
}

/** A persisted draft/published run header (Phase 2 DB shape). */
export interface ScheduleRun {
  id: string;
  clubId: string;
  workDate: string;
  solverVersion: string;
  status: "draft" | "published" | "superseded";
  generatedAt: string;
}
