/**
 * _shared/dealer-utils.ts  — FIXED VERSION (single source of truth)
 *
 * IMPORTANT: Delete deploy-package/shared/dealer-utils.ts (575-line old copy).
 *            All edge functions must import from functions/_shared/dealer-utils.ts
 *
 * Key fixes:
 *  [FIX-A] pickNextDealer: honor priority_break_flag — deprioritize overworked dealers
 *  [FIX-B] fillEmptyTables: add conflicted dealer to exclusion set before retry
 *  [FIX-C] pickNextDealer: fatigue hard-exclude now also checks priority_break_flag
 *  [FIX-D] evaluateBreakNeed: expose shouldBreak for upstream use
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  rest_bonus: number;
  fatigue_penalty: number;
  tier_bonus: number;
  back_to_back_penalty: number;
  consecutive_penalty: number;
  mixed_bonus: number;
  skill_bonus: number;
  priority_break_penalty: number;
  high_fatigue_penalty: number;
  heavy_worker_penalty: number;
  consecutive_high_penalty: number;
  tier_back_to_back_penalty: number;
}

export interface PickDealerOptions {
  tourTier?: "HIGH" | "MEDIUM" | "LOW";
  swingDurationMinutes?: number;
  requiredGameTypes?: string[];
  currentTableId?: string;
  excludeAttendanceIds?: Set<string>;
  returnTopN?: number;
  includeScoreBreakdown?: boolean;
}

export interface DealerCandidate {
  id: string;
  dealer_id: string;
  full_name: string;
  telegram_username?: string;
  telegram_user_id?: string;
  tier: "A" | "B" | "C";
  skills: string[];
  worked_minutes_since_last_break: number;
  last_table_id?: string;
  consecutive_assignments: number;
  rest_minutes: number;
  priority_break_flag: boolean;
  score?: number;
  score_breakdown?: ScoreBreakdown;
}

export interface FillResult {
  assignments: Array<{
    table_id: string;
    table_name: string;
    attendance_id: string;
    full_name: string;
  }>;
  assignedAttendanceIds: Set<string>;
}

export interface SwingDurationResult {
  durationMinutes: number;
  isDynamic: boolean;
  poolRatio: number;
  durationRationale: string;
}

export interface BreakDecision {
  shouldBreak: boolean;
  reason: "mandatory" | "balance" | "priority_flag" | "none";
  workedMinutes: number;
}

export type SupabaseAdmin = ReturnType<typeof createClient>;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extraHeaders },
  });
}

// ─── pickNextDealer ───────────────────────────────────────────────────────────

async function buildDealerCandidates(
  admin: ReturnType<typeof createClient>,
  clubId: string,
  options: PickDealerOptions = {}
): Promise<DealerCandidate[]> {
  const {
    tourTier,
    requiredGameTypes,
    currentTableId,
    excludeAttendanceIds = new Set(),
    includeScoreBreakdown,
  } = options;

  // Step 1: Get active dealer IDs for this club
  const { data: clubDealers } = await admin
    .from("dealers")
    .select("id")
    .eq("club_id", clubId)
    .eq("status", "active");
  const dealerIds = (clubDealers ?? []).map((d: { id: string }) => d.id);
  if (dealerIds.length === 0) return [];

  // Step 2: Query dealer_attendance (no nested view join)
  const { data: rows, error } = await admin
    .from("dealer_attendance")
    .select(
      `id, dealer_id, current_state, status,
       worked_minutes_since_last_break, priority_break_flag,
       dealers!inner(
         full_name, telegram_username, telegram_user_id,
         tier, skills
       )`
    )
    .eq("current_state", "available")
    .eq("status", "checked_in")
    .in("dealer_id", dealerIds);

  if (error) {
    console.error("[pickNextDealer] query error:", error.message);
    return [];
  }

  // Step 3: Query dealer_shift_metrics separately (it's a VIEW, no FK resolution)
  const attendanceIds = (rows ?? []).map((r: { id: string }) => r.id);
  const { data: metricsRows } = await admin
    .from("dealer_shift_metrics")
    .select("attendance_id, minutes_since_rest, total_assignments")
    .in("attendance_id", attendanceIds);
  const metricsMap = new Map(
    (metricsRows ?? []).map((m: { attendance_id: string; minutes_since_rest: number; total_assignments: number }) => [m.attendance_id, m])
  );

  // Step 4: Query last 2 assignments per attendance for back-to-back detection
  const { data: lastAssignments } = await admin
    .from("dealer_assignments")
    .select("attendance_id, table_id, game_tables!inner(tour_tier)")
    .in("attendance_id", attendanceIds)
    .order("assigned_at", { ascending: false });
  const lastTableMap = new Map<string, string>();
  const lastTourTierMap = new Map<string, string>();
  for (const a of lastAssignments ?? []) {
    if (!lastTableMap.has(a.attendance_id)) {
      lastTableMap.set(a.attendance_id, a.table_id);
      lastTourTierMap.set(a.attendance_id, (a.game_tables as any)?.tour_tier ?? "");
    }
  }

  // Step 5: Exclude dealers who already have an active assignment on ANY attendance record
  // (prevents same dealer being assigned via different attendance records)
  const candidateDealerIds = (rows ?? []).map((r: { dealer_id: string }) => r.dealer_id);
  const busyDealerIds = new Set<string>();
  if (candidateDealerIds.length > 0) {
    const { data: busyDealers } = await admin
      .from("dealer_attendance")
      .select("dealer_id")
      .in("dealer_id", candidateDealerIds)
      .in("current_state", ["assigned", "pre_assigned"]);
    for (const bd of busyDealers ?? []) {
      busyDealerIds.add(bd.dealer_id);
    }
  }

  const candidates: DealerCandidate[] = [];

  for (const row of rows ?? []) {
    if (busyDealerIds.has(row.dealer_id)) continue;
    if (excludeAttendanceIds.has(row.id)) continue;

    const d = row.dealers;
    const tier: "A" | "B" | "C" = d.tier ?? "C";
    const skills: string[] = d.skills ?? [];
    const workedMin = row.worked_minutes_since_last_break ?? 0;
    const metric = metricsMap.get(row.id);
    const restMin = metric?.minutes_since_rest ?? 999;
    const consecutive = metric?.total_assignments ?? 0;
    const lastTableId = lastTableMap.get(row.id) ?? null;
    const lastTourTier = lastTourTierMap.get(row.id) ?? "";
    const priorityBreak = row.priority_break_flag ?? false;

    if (tourTier === "HIGH" && tier === "C") continue;

    if (priorityBreak && restMin >= 100) continue;

    if (restMin >= 105) continue;

    if (
      requiredGameTypes &&
      requiredGameTypes.length > 0 &&
      !requiredGameTypes.some((g) => skills.includes(g))
    ) {
      continue;
    }

    let score = 0;
    const breakdown: ScoreBreakdown = {
      rest_bonus: 0, fatigue_penalty: 0, tier_bonus: 0,
      back_to_back_penalty: 0, consecutive_penalty: 0,
      mixed_bonus: 0, skill_bonus: 0,
      priority_break_penalty: 0, high_fatigue_penalty: 0,
      heavy_worker_penalty: 0, consecutive_high_penalty: 0,
      tier_back_to_back_penalty: 0,
    };

    if (restMin >= 20) { breakdown.rest_bonus = 200; score += 200; }
    else if (restMin >= 10) { breakdown.rest_bonus = 100; score += 100; }
    else if (restMin >= 5) { breakdown.rest_bonus = 50; score += 50; }

    // Fatigue: use restMin (minutes_since_rest from dealer_shift_metrics view — real-time)
    // rather than workedMin (worked_minutes_since_last_break column — stale between swings)
    const fatigueMinutes = restMin;
    breakdown.fatigue_penalty = -Math.floor(fatigueMinutes / 10) * 5;
    score += breakdown.fatigue_penalty;

    if (tourTier === "HIGH") {
      if (tier === "A") { breakdown.tier_bonus = 30; score += 30; }
      else if (tier === "B") { breakdown.tier_bonus = 5; score += 5; }
    } else if (tourTier === "MEDIUM") {
      if (tier === "B") { breakdown.tier_bonus = 20; score += 20; }
    } else {
      if (tier === "C") { breakdown.tier_bonus = 20; score += 20; }
    }

    if (consecutive >= 3) {
      breakdown.consecutive_penalty = -consecutive * 10;
      score += breakdown.consecutive_penalty;
    }

    if (skills.includes("Mixed")) { breakdown.mixed_bonus = 2; score += 2; }
    if (requiredGameTypes) {
      for (const g of requiredGameTypes) {
        if (skills.includes(g)) { breakdown.skill_bonus += 20; score += 20; }
      }
    }

    if (priorityBreak) {
      breakdown.priority_break_penalty = -500;
      score += breakdown.priority_break_penalty;
    }

    if (restMin >= 90) { breakdown.high_fatigue_penalty = -100; score -= 100; }
    else if (restMin >= 75) { breakdown.high_fatigue_penalty = -50; score -= 50; }

    // ── Heavy worker penalty ──
    // Dealer with 3+ total assignments in this shift → reduce priority
    // to prevent the same dealer being picked repeatedly
    if (consecutive >= 3) {
      breakdown.heavy_worker_penalty = -10 * (consecutive - 2);
      score += breakdown.heavy_worker_penalty;
    }

    // ── Consecutive HIGH penalty ──
    // Dealer assigned to HIGH tables in last 2 swings → lower priority for HIGH
    if (tourTier === "HIGH" && lastTourTier === "HIGH") {
      breakdown.consecutive_high_penalty = -20;
      score += breakdown.consecutive_high_penalty;
    }

    // ── Tier-aware back-to-back ──
    // Returning to the same table is penalized 50% less if switching tour tiers
    if (lastTableId && lastTableId === currentTableId) {
      const sameTier = lastTourTier === tourTier;
      breakdown.tier_back_to_back_penalty = sameTier ? -50 : -25;
      score += breakdown.tier_back_to_back_penalty;
    }

    const candidate: DealerCandidate = {
      id: row.id,
      dealer_id: row.dealer_id,
      full_name: d.full_name,
      telegram_username: d.telegram_username,
      telegram_user_id: d.telegram_user_id,
      tier,
      skills,
      worked_minutes_since_last_break: workedMin,
      last_table_id: lastTableId,
      consecutive_assignments: consecutive,
      rest_minutes: restMin,
      priority_break_flag: priorityBreak,
      score,
    };

    if (includeScoreBreakdown) {
      candidate.score_breakdown = breakdown;
    }

    candidates.push(candidate);
  }

  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return candidates;
}

export async function pickNextDealer(
  admin: ReturnType<typeof createClient>,
  clubId: string,
  options: PickDealerOptions = {}
): Promise<DealerCandidate | null> {
  const candidates = await buildDealerCandidates(admin, clubId, options);
  return candidates[0] ?? null;
}

export async function pickTopDealers(
  admin: ReturnType<typeof createClient>,
  clubId: string,
  topN: number,
  options: Omit<PickDealerOptions, "returnTopN"> = {}
): Promise<DealerCandidate[]> {
  const candidates = await buildDealerCandidates(admin, clubId, options);
  return candidates.slice(0, topN);
}

export function buildScoreLabel(tier: string, scoreBreakdown: ScoreBreakdown): string {
  const parts: string[] = [];
  if (tier === "A") parts.push("Dealer hạng A ưu tiên");
  else if (tier === "B") parts.push("Hạng B – phù hợp");
  if (scoreBreakdown.rest_bonus >= 200) parts.push("Thời gian nghỉ dài");
  else if (scoreBreakdown.rest_bonus >= 100) parts.push("Nghỉ ngơi đủ");
  if (scoreBreakdown.fatigue_penalty > -30) parts.push("Thời gian làm ít nhất");
  if (scoreBreakdown.skill_bonus > 0) parts.push("Có kỹ năng phù hợp");
  if (scoreBreakdown.tier_back_to_back_penalty < 0) parts.push("Tránh bàn cũ");
  if (scoreBreakdown.heavy_worker_penalty < 0) parts.push("Đã làm nhiều swing");
  if (scoreBreakdown.consecutive_high_penalty < 0) parts.push("Nghỉ bàn HIGH");
  if (scoreBreakdown.priority_break_penalty < 0) parts.push("Đến giờ nghỉ");
  return parts.length ? parts.join(" · ") : "Sẵn sàng";
}

// ─── fillEmptyTables ─────────────────────────────────────────────────────────

export async function fillEmptyTables(
  admin: ReturnType<typeof createClient>,
  clubId: string,
  shiftId: string | undefined,
  botToken: string,
  initialExclude?: Set<string>,
  swingDueAt?: string  // pass pre-calculated swing_due_at for batch consistency
): Promise<FillResult> {
  const result: FillResult = {
    assignments: [],
    assignedAttendanceIds: new Set(),
  };

  let tableQuery = admin
    .from("game_tables")
    .select("id, table_name, table_type, current_blind_level")
    .eq("club_id", clubId)
    .eq("status", "active");

  if (shiftId) tableQuery = tableQuery.eq("shift_id", shiftId);

  const { data: tables, error: tableErr } = await tableQuery;
  if (tableErr || !tables) return result;

  const { data: activeAssignments } = await admin
    .from("dealer_assignments")
    .select("table_id")
    .in("status", ["assigned", "pre_assigned"])
    .in(
      "table_id",
      tables.map((t: { id: string }) => t.id)
    );

  const assignedTableIds = new Set(
    (activeAssignments ?? []).map((a: { table_id: string }) => a.table_id)
  );

  const emptyTables = tables
    .filter((t: { id: string }) => !assignedTableIds.has(t.id))
    .sort((a: { current_blind_level: number }, b: { current_blind_level: number }) =>
      (b.current_blind_level ?? 0) - (a.current_blind_level ?? 0)
    );

  const localExclude = new Set<string>(initialExclude ?? []);

  for (const table of emptyTables) {
    let assigned = false;
    let lastConflictDealerId: string | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const excludeSet = new Set([
        ...localExclude,
        ...(lastConflictDealerId ? [lastConflictDealerId] : []),
      ]);

      const dealer = await pickNextDealer(admin, clubId, {
        currentTableId: table.id,
        excludeAttendanceIds: excludeSet,
      });

      if (!dealer) break;

      const { data: rpcResult, error: rpcErr } = await admin.rpc(
        "assign_dealer_to_table",
        {
          p_table_id: table.id,
          p_attendance_id: dealer.id,
          p_swing_due_at: swingDueAt ?? null,
        }
      );

      if (rpcErr) {
        console.warn(
          `[fillEmptyTables] assign conflict attempt ${attempt + 1} for table ${table.id}:`,
          rpcErr.message
        );
        lastConflictDealerId = dealer.id;
        continue;
      }

      if (rpcResult === "ok" || rpcResult?.outcome === "assigned") {
        localExclude.add(dealer.id);
        result.assignedAttendanceIds.add(dealer.id);
        result.assignments.push({
          table_id: table.id,
          table_name: table.table_name,
          attendance_id: dealer.id,
          full_name: dealer.full_name,
        });
        assigned = true;
        break;
      }

      if (rpcResult === "conflict") {
        lastConflictDealerId = dealer.id;
        continue;
      }

      lastConflictDealerId = dealer.id;
    }

    if (!assigned) {
      console.warn(
        `[fillEmptyTables] Could not assign dealer to table ${table.table_name} after 3 attempts`
      );
    }
  }

  return result;
}

// ─── evaluateBreakNeed ────────────────────────────────────────────────────────

export async function evaluateBreakNeed(
  admin: ReturnType<typeof createClient>,
  attendanceId: string,
  options: { maxWorkMinutes?: number; minWorkMinutes?: number; clubId?: string } = {}
): Promise<BreakDecision> {
  const maxWork = options.maxWorkMinutes ?? 120;
  const minWork = options.minWorkMinutes ?? 60;

  const { data: attendance } = await admin
    .from("dealer_attendance")
    .select("priority_break_flag, dealer_id")
    .eq("id", attendanceId)
    .single();

  if (!attendance) {
    return { shouldBreak: false, reason: "none", workedMinutes: 0 };
  }

  // Use minutes_since_rest from dealer_shift_metrics VIEW (real-time computation)
  // instead of worked_minutes_since_last_break column (stale between swings)
  const { data: metrics } = await admin
    .from("dealer_shift_metrics")
    .select("minutes_since_rest, total_break_minutes, total_worked_minutes")
    .eq("attendance_id", attendanceId)
    .maybeSingle();

  const worked = metrics?.minutes_since_rest ?? 0;

  if (attendance.priority_break_flag && worked >= minWork) {
    return { shouldBreak: true, reason: "priority_flag", workedMinutes: worked };
  }

  if (worked >= maxWork) {
    return { shouldBreak: true, reason: "mandatory", workedMinutes: worked };
  }

  if (worked >= minWork && options.clubId) {
    const { data: allMetrics } = await admin
      .from("dealer_shift_metrics")
      .select("total_worked_minutes, total_break_minutes")
      .eq("club_id", options.clubId);

    const totalWorked = (allMetrics ?? []).reduce(
      (s: number, m: { total_worked_minutes: number }) => s + (m.total_worked_minutes ?? 0), 0
    );
    const totalBreak = (allMetrics ?? []).reduce(
      (s: number, m: { total_break_minutes: number }) => s + (m.total_break_minutes ?? 0), 0
    );
    const avgBreakRatio = totalWorked > 0 ? totalBreak / totalWorked : 0.15;

    const thisDealerBreak = metrics?.total_break_minutes ?? 0;
    const thisDealerRatio = worked > 0 ? thisDealerBreak / (thisDealerBreak + worked) : 0;

    if (thisDealerRatio < avgBreakRatio * 0.8) {
      return { shouldBreak: true, reason: "balance", workedMinutes: worked };
    }
  }

  return { shouldBreak: false, reason: "none", workedMinutes: worked };
}

// ─── computeSwingDuration ────────────────────────────────────────────────────

export async function computeSwingDuration(
  admin: ReturnType<typeof createClient>,
  clubId: string,
  config: { swing_duration_minutes: number; auto_adjust_duration: boolean; min_duration: number }
): Promise<SwingDurationResult> {
  if (!config.auto_adjust_duration) {
    return {
      durationMinutes: config.swing_duration_minutes,
      isDynamic: false,
      poolRatio: 1,
      durationRationale: `fixed:${config.swing_duration_minutes}min`,
    };
  }

  const { data: rpcResult } = await admin.rpc("calculate_dynamic_swing_duration", {
    p_club_id: clubId,
    p_table_type: "tournament",
  });

  if (rpcResult == null) {
    return {
      durationMinutes: config.swing_duration_minutes,
      isDynamic: false,
      poolRatio: 1,
      durationRationale: `rpc_fallback:${config.swing_duration_minutes}min`,
    };
  }

  const durationMinutes = typeof rpcResult === "number" ? rpcResult : config.swing_duration_minutes;

  return {
    durationMinutes,
    isDynamic: true,
    poolRatio: 1,
    durationRationale: `dynamic:${durationMinutes}min|base:${config.swing_duration_minutes}min`,
  };
}

// ─── getTableIdsForClub ──────────────────────────────────────────────────────

export async function getTableIdsForClub(
  admin: ReturnType<typeof createClient>,
  clubId: string
): Promise<string[]> {
  const { data } = await admin
    .from("game_tables")
    .select("id")
    .eq("club_id", clubId)
    .eq("status", "active");
  return (data ?? []).map((t: { id: string }) => t.id);
}
