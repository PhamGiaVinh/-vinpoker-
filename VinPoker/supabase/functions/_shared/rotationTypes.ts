import type { DealerCandidate, ScoreBreakdown } from "./pickNextDealer.ts";

export type RotationTier = "HIGH" | "MEDIUM" | "LOW";

export interface RotationTable {
  id: string;
  tourTier: RotationTier;
  gameTypes: string[];
  currentAttendanceId: string | null;
}

export interface RotationCandidate {
  attendanceId: string;
  dealerId: string;
  fullName: string;
  tier: "A" | "B" | "C";
  skills: string[];
  workedMinutesSinceLastBreak: number;
  lastTableId: string | null;
  consecutiveAssignments: number;
  restMinutes: number;
  priorityBreakFlag: boolean;
  currentState: "available" | "on_break";
  lastTourTier: string;
  score: number;
  scoreBreakdown?: ScoreBreakdown;
}

export interface RotationPair {
  tableId: string;
  attendanceId: string;
  candidateName: string;
  score: number;
}

export type MissedTableReason =
  | "no_candidates"
  | "tier_excluded"
  | "game_type_excluded"
  | "all_busy";

export interface RotationResult {
  pairs: RotationPair[];
  unassignedTables: Array<{ tableId: string; reason: MissedTableReason }>;
  solverVersion: "greedy-v1";
  solvedAt: string;
}

export interface ScoreCandidateInput {
  tier: RotationTier;
  skills: string[];
  workedMin: number;
  restMin: number;
  consecutive: number;
  lastTableId: string | null;
  lastTourTier: string;
  priorityBreak: boolean;
  currentState: "available" | "on_break";
  avgBreakRatio: number | null;
  clubBreakDurationMinutes: number;
  requiredGameTypes: string[];
  currentTableId: string | null;
  isPrioritySwing: boolean;
  skipPriorityBreakGuard: boolean;
  skipFatigueHardCap: boolean;
  metric: {
    total_break_minutes: number;
    total_worked_minutes: number;
    total_assignments: number;
    minutes_since_rest: number;
  } | null;
  fatigueHardCap: boolean;
}

export interface ScoreCandidateOptions {
  tourTier: RotationTier;
  currentTableId: string | null;
  requiredGameTypes: string[];
  isPrioritySwing: boolean;
  avgBreakRatio: number | null;
  clubBreakDurationMinutes: number;
  skipPriorityBreakGuard: boolean;
  skipFatigueHardCap: boolean;
}

export interface Pass15Options {
  dryRun: boolean;
  preAnnounceMinutes: number;
  requiredGameTypes: string[];
  cycleExcludedIds: Set<string>;
  clubId: string;
}

export type Pass15Result = {
  assigned: number;
  unassigned: number;
  raceLost: number;
  errors: Array<{ tableId: string; error: string }>;
  missReasons: Partial<Record<MissedTableReason, number>>;
  solverDurationMs: number;
  dryRun?: boolean;
  diff?: Array<{
    tableId: string;
    tourTier: string;
    wouldAssignAttendanceId: string;
    wouldAssignName: string;
    score: number;
  }>;
  /** Present only when the candidate snapshot failed; never a clean shortage. */
  candidateStatus?: "dependency_unavailable" | "query_failed";
  candidateErrorCode?: string;
};

export function normalizeGameTypes(types: string[] | null | undefined): string[] {
  if (!types) return [];
  return types.filter(Boolean).map(t => t.trim().toLowerCase());
}

export function toRotationCandidate(
  c: DealerCandidate,
  avgBreakRatio: number | null
): RotationCandidate {
  return {
    attendanceId: c.id,
    dealerId: c.dealer_id,
    fullName: c.full_name,
    tier: c.tier,
    skills: normalizeGameTypes(c.skills),
    workedMinutesSinceLastBreak: c.worked_minutes_since_last_break,
    lastTableId: c.last_table_id ?? null,
    consecutiveAssignments: c.consecutive_assignments,
    restMinutes: c.rest_minutes,
    priorityBreakFlag: c.priority_break_flag,
    currentState: c.current_state,
    lastTourTier: c.last_tour_tier,
    score: c.score ?? 0,
    scoreBreakdown: c.score_breakdown,
  };
}

// ============================================================
// Forward Rotation Scheduler (Pass R) — pure-solver contracts
// ============================================================

export type DealerTier = "A" | "B" | "C";

/** R5 — map tournament buy-in to the preferred dealer tier.
 *  Thresholds are club-configurable (swing_config.tier_a_min_buyin / tier_b_min_buyin). */
export function tierForBuyIn(
  buyIn: number | null | undefined,
  tierAMin = 10_000_000,
  tierBMin = 3_000_000
): DealerTier | null {
  if (buyIn == null || !Number.isFinite(buyIn) || buyIn <= 0) return null;
  if (buyIn > tierAMin) return "A";
  if (buyIn >= tierBMin) return "B";
  return "C";
}

/** A table with an active dealer that will eventually need relief. */
export interface RotationPlanTable {
  tableId: string;
  tableName: string;
  assignmentId: string;
  outAttendanceId: string;
  outDealerName: string;
  /** When the current dealer sat in (ms epoch). R4 urgency key. */
  assignedAtMs: number;
  /** Immutable contract time — never pushed by the planner. */
  swingDueAtMs: number;
  /** This table's swing duration, used to project forecast rounds. */
  swingDurationMs: number;
  /** R5 preferred dealer tier (from buy_in), null = any. */
  requiredTier: DealerTier | null;
  tournamentId: string | null;
  tournamentName: string | null;
  gameTypes: string[];
  /** Existing CHỐT: solver must NOT re-plan slot 0 for this table. */
  lockedInAttendanceId?: string | null;
  lockedPlannedReliefAtMs?: number | null;
  /** Patch 5c — feature/final pool gate. When non-null, ONLY these dealer_ids may
   *  be planned INTO this table at slot 0 (the real CHỐT). null/undefined = ungated
   *  (normal table or kill-switch off). An EMPTY array = special table with no pool
   *  member → clean shortage (never a non-pool substitution). Mirrors the SQL trigger
   *  `_assert_dealer_allowed_for_table` so the planner cannot announce a dealer the
   *  seat trigger would later reject with DT006. */
  poolDealerIds?: string[] | null;
}

/** A dealer who is (or will become) available to take a table. */
export interface RotationPlanCandidate {
  attendanceId: string;
  dealerId: string;
  fullName: string;
  tier: DealerTier;
  skills: string[];
  /** R3 fairness key — minutes of the PREVIOUS dealing session (0 = never dealt). */
  prevSessionMinutes: number;
  /** R1 — earliest moment the dealer may ENTER a table (rest + cooldown complete). */
  eligibleAtMs: number;
  /** Existing health score — final tie-break only. */
  score: number;
}

export interface RotationPlanOptions {
  /** Injected clock — the solver never reads Date.now(). */
  nowMs: number;
  /** R2 hard minimum announce→entry lead (3 min). */
  announceLeadMs: number;
  /** Normal announce lead for non-emergency rotations (pre_announce_minutes). */
  preAnnounceMs: number;
  /** R1 rest applied to out-dealers in forecast simulation (10 min). */
  restMs: number;
  /** How many forecast slots beyond slot 0 (2 → slots 1..2). */
  forecastSlots: number;
  /** Patch 5d — dealers reserved to a feature/final pool. They are EXCLUSIVE to their
   *  special table and must NOT be planned onto any NORMAL table (poolDealerIds == null).
   *  Empty/undefined = no reservation (kill-switch off). A reserved dealer is still
   *  allowed on their own special table via that table's poolDealerIds. */
  reservedDealerIds?: string[];
  solverVersion: string;
}

export interface RotationPlanRow {
  tableId: string;
  /** Assignment being relieved. Null on forecast slots (future assignments don't exist yet). */
  assignmentId: string | null;
  /** 0 = TIẾP THEO (lockable), 1..2 = DỰ ĐOÁN (never locks a dealer). */
  slotIndex: number;
  outAttendanceId: string | null;
  inAttendanceId: string | null;
  inDealerName: string | null;
  /** Honest relief time: >= max(swing_due_at, eligible_at + 3min, now + 3min). */
  plannedReliefAtMs: number;
  announceAtMs: number | null;
  /** Relief is later than the table's ideal time because the pool can't cover it. */
  isShortage: boolean;
  /** Table already overdue at plan time → 3-min announce lead instead of full pre-announce. */
  isEmergency: boolean;
  requiredTier: DealerTier | null;
  tierMatched: boolean;
  score: number | null;
  reason: Record<string, unknown>;
}

export interface RotationPlan {
  rows: RotationPlanRow[];
  solverVersion: string;
  /** Tables whose slot 0 was left alone because an existing CHỐT is sticky. */
  lockedTableIds: string[];
}

export function toScoreCandidateInput(
  c: RotationCandidate,
  table: RotationTable,
  opts: ScoreCandidateOptions
): ScoreCandidateInput {
  const fatigueHardCap = c.consecutiveAssignments >= 4 && c.restMinutes < 10;

  return {
    tier: opts.tourTier,
    skills: c.skills,
    workedMin: c.workedMinutesSinceLastBreak,
    restMin: c.restMinutes,
    consecutive: c.consecutiveAssignments,
    lastTableId: c.lastTableId,
    lastTourTier: c.lastTourTier,
    priorityBreak: c.priorityBreakFlag,
    currentState: c.currentState,
    avgBreakRatio: opts.avgBreakRatio,
    clubBreakDurationMinutes: opts.clubBreakDurationMinutes,
    requiredGameTypes: opts.requiredGameTypes,
    currentTableId: opts.currentTableId,
    isPrioritySwing: opts.isPrioritySwing,
    skipPriorityBreakGuard: opts.skipPriorityBreakGuard,
    skipFatigueHardCap: opts.skipFatigueHardCap,
    metric: null,
    fatigueHardCap,
  };
}
