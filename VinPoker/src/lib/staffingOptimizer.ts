// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Swing — live staffing optimizer (pure)
// ═══════════════════════════════════════════════════════════════════════════════
// Owner request 2026-07-04: a live card that shows how many MORE dealers are needed,
// how many are SURPLUS, and WHICH dealers could be checked out — to optimize labor
// cost ("dựa vào số tỉ lệ bàn và thuật toán đã làm").
//
// STAFFING TARGET (owner-chosen: "theo nhịp xoay ca thật"): to keep every active
// table continuously covered while dealers rotate out for the mandated inter-swing
// rest, you need a buffer above the raw table count. With a deal stint of
// `swingDurationMin` followed by `minRestMin` rest, the fraction of time a dealer
// is resting is minRest/(deal+minRest), so the steady-state headcount to cover
// `activeTables` tables is:
//
//     required = ceil(activeTables * (deal + minRest) / deal)
//
// e.g. 10 tables, deal 40', rest 13'  →  ceil(10 * 53/40) = ceil(13.25) = 14
// (i.e. ~4 dealers always rotating/resting). The buffer is shown transparently.
//
// PURE + advisory only — no side effects, no money-path writes. The card reuses the
// existing DC batch-checkout flow for any actual release.

/** Reasonable fallbacks when a club's swing_config is missing a field. */
export const DEFAULT_SWING_DURATION_MIN = 40;
export const DEFAULT_MIN_REST_MIN = 13;

export interface StaffingTarget {
  /** Steady-state dealers needed to keep all active tables covered with rotation. */
  required: number;
  /** required − activeTables = the rotation/rest reserve. */
  buffer: number;
}

export function computeStaffingTarget(args: {
  activeTables: number;
  swingDurationMin?: number | null;
  minRestMin?: number | null;
}): StaffingTarget {
  const tables = Math.max(0, Math.round(args.activeTables));
  if (tables === 0) return { required: 0, buffer: 0 };
  const deal = args.swingDurationMin && args.swingDurationMin > 0 ? args.swingDurationMin : DEFAULT_SWING_DURATION_MIN;
  const rest = args.minRestMin != null && args.minRestMin >= 0 ? args.minRestMin : DEFAULT_MIN_REST_MIN;
  const required = Math.ceil((tables * (deal + rest)) / deal);
  return { required, buffer: required - tables };
}

export type StaffingStatus = "balanced" | "short" | "over";

export interface StaffingResult extends StaffingTarget {
  activeTables: number;
  /** Checked-in dealers who are NOT checked out (available+assigned+pre_assigned+on_break). */
  present: number;
  /** max(0, required − present). */
  deficit: number;
  /** max(0, present − required). */
  surplus: number;
  status: StaffingStatus;
}

export function computeStaffing(args: {
  activeTables: number;
  present: number;
  swingDurationMin?: number | null;
  minRestMin?: number | null;
}): StaffingResult {
  const target = computeStaffingTarget(args);
  const present = Math.max(0, Math.round(args.present));
  const deficit = Math.max(0, target.required - present);
  const surplus = Math.max(0, present - target.required);
  const status: StaffingStatus = deficit > 0 ? "short" : surplus > 0 ? "over" : "balanced";
  return { ...target, activeTables: Math.max(0, Math.round(args.activeTables)), present, deficit, surplus, status };
}

// ── Release-candidate ranking (inverse of the assignment picker) ────────────────

export type DealerTier = "A" | "B" | "C" | string;

export interface ReleaseCandidateInput {
  attendanceId: string;
  name: string;
  /** dealer_attendance.current_state */
  state: string;
  tier: DealerTier;
  /** minutes worked today (live). */
  workedMin: number;
  /** ISO of last release from a table (rest ordering tiebreak). */
  lastReleasedAt?: string | null;
}

export interface ReleaseCandidate extends ReleaseCandidateInput {
  stateLabel: string;
}

const STATE_LABEL: Record<string, string> = {
  available: "đang rảnh",
  on_break: "đang nghỉ",
  assigned: "đang chia",
  pre_assigned: "chờ vào bàn",
};

// Lower = more expendable to release first. Tier C (junior) before B before A (lead).
function tierRank(tier: DealerTier): number {
  return tier === "C" ? 0 : tier === "B" ? 1 : tier === "A" ? 2 : 1;
}

/**
 * Rank dealers to release when overstaffed. Only dealers NOT currently covering a
 * table are candidates (available | on_break) — releasing an `assigned` dealer
 * would uncover a live table, so they are excluded. Order: most minutes worked
 * first (fairness + cuts OT risk), then lowest tier (least table-quality impact),
 * then longest since last release. Returns at most `limit` (the surplus).
 */
export function rankReleaseCandidates(
  dealers: ReleaseCandidateInput[],
  limit: number
): ReleaseCandidate[] {
  if (limit <= 0) return [];
  return dealers
    .filter((d) => d.state === "available" || d.state === "on_break")
    .slice()
    .sort((a, b) => {
      if (b.workedMin !== a.workedMin) return b.workedMin - a.workedMin;
      const tr = tierRank(a.tier) - tierRank(b.tier);
      if (tr !== 0) return tr;
      const la = a.lastReleasedAt ? Date.parse(a.lastReleasedAt) : Number.POSITIVE_INFINITY;
      const lb = b.lastReleasedAt ? Date.parse(b.lastReleasedAt) : Number.POSITIVE_INFINITY;
      return la - lb;
    })
    .slice(0, limit)
    .map((d) => ({ ...d, stateLabel: STATE_LABEL[d.state] ?? d.state }));
}
