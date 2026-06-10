/**
 * _shared/evaluateBreakNeed.ts
 *
 * 5-rule break decision tree with deadlock guard.
 *
 * Rules (evaluated in order — first match wins):
 *   1. MANDATORY  — workedMinutes >= maxWork. Non-negotiable.
 *   2. PRIORITY   — priority_break_flag set AND workedMinutes >= minWork.
 *   3. BALANCE    — dealer's break ratio < 80% of club average.
 *   4. DEADLOCK   — dealer pool empty AND workedMinutes >= minWork * 1.5.
 *   5. NONE       — no break needed.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BreakDecision {
  shouldBreak: boolean;
  reason: "mandatory" | "priority_flag" | "balance" | "deadlock_guard" | "none";
  workedMinutes: number;
}

export interface BreakEvalOptions {
  maxWorkMinutes?: number;
  minWorkMinutes?: number;
  clubId?: string;
  /** Caller-supplied snapshot of how many available dealers exist (skip DB query). */
  availableDealerCount?: number;
  /** Club-scoped dealer IDs for filtering the Rule 4 fallback query. Required. */
  clubDealerIds?: string[];
}

const DEFAULT_MAX_WORK = 120;
const DEFAULT_MIN_WORK = 60;

export type SupabaseAdmin = any;

interface AttendanceBreakEvalRow {
  priority_break_flag: boolean | null;
  dealer_id: string | null;
}

interface ShiftMetricsRow {
  minutes_since_rest: number | null;
  total_break_minutes: number | null;
  total_worked_minutes: number | null;
}

interface AttendanceWorkRow {
  worked_minutes_since_last_break: number | null;
  check_in_time: string | null;
}

interface AssignmentIdRow {
  id: string;
}

interface BreakEndRow {
  break_end: string | null;
}

interface ClubMetricRow {
  total_worked_minutes: number | null;
  total_break_minutes: number | null;
}

interface OvertimeAssignmentRow {
  overtime_started_at: string | null;
}

// ─── evaluateBreakNeed ────────────────────────────────────────────────────────

export async function evaluateBreakNeed(
  admin: SupabaseAdmin,
  attendanceId: string,
  options: BreakEvalOptions = {}
): Promise<BreakDecision> {
  const maxWork = options.maxWorkMinutes ?? DEFAULT_MAX_WORK;
  const minWork = options.minWorkMinutes ?? DEFAULT_MIN_WORK;
  const clubDealerIds = options.clubDealerIds ?? [];

  const { data: attendance } = await admin
    .from("dealer_attendance")
    .select("priority_break_flag, dealer_id")
    .eq("id", attendanceId)
    .single() as unknown as { data: AttendanceBreakEvalRow | null };

  if (!attendance) {
    return { shouldBreak: false, reason: "none", workedMinutes: 0 };
  }

  const { data: shiftMetrics } = await admin
    .from("dealer_shift_metrics")
    .select("minutes_since_rest, total_break_minutes, total_worked_minutes")
    .eq("attendance_id", attendanceId)
    .maybeSingle() as unknown as { data: ShiftMetricsRow | null };

  let worked = 0;
  if (shiftMetrics) {
    worked = shiftMetrics.minutes_since_rest ?? 0;
  } else {
    // Tier 2: dealer_attendance.worked_minutes_since_last_break
    const { data: att } = await admin
      .from("dealer_attendance")
      .select("worked_minutes_since_last_break, check_in_time")
      .eq("id", attendanceId)
      .single() as unknown as { data: AttendanceWorkRow | null };

    if (att?.worked_minutes_since_last_break != null) {
      worked = att.worked_minutes_since_last_break;
    } else {
      // Tier 3: Compute from dealer_breaks + check_in_time
      let baseline: Date | null = null;
      const { data: currentAssignment } = await admin
        .from("dealer_assignments")
        .select("id")
        .eq("attendance_id", attendanceId)
        .eq("status", "assigned")
        .maybeSingle() as unknown as { data: AssignmentIdRow | null };

      if (currentAssignment) {
        const { data: lastBreak } = await admin
          .from("dealer_breaks")
          .select("break_end")
          .eq("assignment_id", currentAssignment.id)
          .not("break_end", "is", null)
          .order("break_end", { ascending: false })
          .limit(1)
          .maybeSingle() as unknown as { data: BreakEndRow | null };
        if (lastBreak?.break_end) baseline = new Date(lastBreak.break_end);
      }

      if (!baseline) {
        const { data: lastAttendanceBreak } = await admin
          .from("dealer_breaks")
          .select("break_end")
          .eq("attendance_id", attendanceId)
          .not("break_end", "is", null)
          .order("break_end", { ascending: false })
          .limit(1)
          .maybeSingle() as unknown as { data: BreakEndRow | null };
        if (lastAttendanceBreak?.break_end) baseline = new Date(lastAttendanceBreak.break_end);
      }

      if (!baseline && att?.check_in_time) baseline = new Date(att.check_in_time);

      worked = baseline
        ? Math.floor((Date.now() - baseline.getTime()) / 60_000)
        : 0;

      console.warn(
        `[evaluateBreakNeed] Tier 3 fallback for ${attendanceId}: worked=${worked}min ` +
        `(from ${baseline ? 'timestamps' : 'zero'})`
      );
    }
  }
  const metrics = shiftMetrics;

  // ── Rule 1: MANDATORY ────────────────────────────────────────────────────
  // Non-negotiable safety threshold. Dealer MUST go to break.
  if (worked >= maxWork) {
    return { shouldBreak: true, reason: "mandatory", workedMinutes: worked };
  }

  // ── Rule 2: PRIORITY FLAG ─────────────────────────────────────────────────
  // Dealer has been flagged as needing break AND has worked at least minWork minutes.
  if (attendance.priority_break_flag && worked >= minWork) {
    return { shouldBreak: true, reason: "priority_flag", workedMinutes: worked };
  }

  // ── Rule 3: BALANCE (equity) ──────────────────────────────────────────────
  // If the dealer's break ratio is significantly below the club average,
  // they should go to break to maintain fairness across the shift.
  if (worked >= minWork && options.clubId) {
    const { data: allMetrics } = await admin
      .from("dealer_shift_metrics")
      .select("total_worked_minutes, total_break_minutes")
      .eq("club_id", options.clubId) as unknown as { data: ClubMetricRow[] | null };

    const totalWorked = (allMetrics ?? []).reduce((s: number, m) => s + (m.total_worked_minutes ?? 0), 0);
    const totalBreak = (allMetrics ?? []).reduce((s: number, m) => s + (m.total_break_minutes ?? 0), 0);
    const avgBreakRatio = totalWorked > 0 ? totalBreak / totalWorked : 0.15;

    const thisDealerBreak = metrics?.total_break_minutes ?? 0;
    const thisDealerRatio = worked > 0 ? thisDealerBreak / (thisDealerBreak + worked) : 0;

    if (thisDealerRatio < avgBreakRatio * 0.8) {
      return { shouldBreak: true, reason: "balance", workedMinutes: worked };
    }
  }

  // ── Rule 4: DEADLOCK GUARD ────────────────────────────────────────────────
  // If the available dealer pool is empty and this dealer has worked
  // significantly more than minWork, send them to break anyway.
  // This releases the deadlock when no replacement is available because
  // all dealers are either assigned or on break.
  if (worked >= minWork * 1.5) {
    let poolEmpty = false;
    if (options.availableDealerCount !== undefined) {
      poolEmpty = options.availableDealerCount === 0;
    } else if (options.clubId && clubDealerIds.length > 0) {
      const { count } = await admin
        .from("dealer_attendance")
        .select("id", { head: true, count: "exact" })
        .in("dealer_id", clubDealerIds)
        .eq("current_state", "available")
        .eq("status", "checked_in");
      poolEmpty = (count ?? 0) === 0;
    } else if (options.clubId) {
      poolEmpty = true;
    }

    if (poolEmpty) {
      // Check how long this dealer has been OT (if at all)
      const { data: assignment } = await admin
        .from("dealer_assignments")
        .select("overtime_started_at")
        .eq("attendance_id", attendanceId)
        .eq("status", "assigned")
        .maybeSingle() as unknown as { data: OvertimeAssignmentRow | null };

      const otMinutes = assignment?.overtime_started_at
        ? Math.floor((Date.now() - new Date(assignment.overtime_started_at as string).getTime()) / 60_000)
        : 0;

      // Only deadlock-send to break if they've been working long enough
      // AND haven't just started OT (give OT a chance to resolve)
      if (otMinutes >= 10) {
        return { shouldBreak: true, reason: "deadlock_guard", workedMinutes: worked };
      }
    }
  }

  // ── Rule 5: NONE ─────────────────────────────────────────────────────────
  return { shouldBreak: false, reason: "none", workedMinutes: worked };
}
