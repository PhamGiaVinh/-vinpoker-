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