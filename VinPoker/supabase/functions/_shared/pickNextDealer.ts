/**
 * _shared/pickNextDealer.ts
 *
 * Dealer selection with scoring, game-type matching, break equity penalty,
 * intra-cycle exclusion, and high-stakes tier guard.
 *
 * Key scoring components:
 *  - rest_bonus: more rest → higher score
 *  - tier_bonus: preferred tier for the table's tournament tier
 *  - skill_bonus: +20 per matching game type skill
 *  - consecutive_penalty: heavy load penalty
 *  - back_to_back_penalty: avoid same table
 *  - priority_break_penalty: -500 when flagged for break
 *  - heavy_worker_penalty: avoid repeatedly picking same dealer
 *  - break_equity_penalty: dealers with deficit break ratio are penalized
 *  - tier_back_to_back_penalty: returning to same table with same tier
 *  - consecutive_high_penalty: rest from HIGH tables after back-to-back HIGH
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  rest_bonus: number;
  tier_bonus: number;
  back_to_back_penalty: number;
  consecutive_penalty: number;
  mixed_bonus: number;
  skill_bonus: number;
  priority_break_penalty: number;
  heavy_worker_penalty: number;
  consecutive_high_penalty: number;
  tier_back_to_back_penalty: number;
  break_equity_penalty: number;
  priority_swing_bonus: number;
  fatigue_penalty: number;
}

export interface PickDealerOptions {
  tourTier?: "HIGH" | "MEDIUM" | "LOW";
  swingDurationMinutes?: number;
  requiredGameTypes?: string[];
  currentTableId?: string;
  excludeAttendanceIds?: Set<string>;
  returnTopN?: number;
  includeScoreBreakdown?: boolean;
  /** Known club average break ratio (pre-fetched). Skips batch query. */
  clubAvgBreakRatio?: number;
  /** Emergency: skip priority_break_flag filter. Use when OT dealer has no normal replacement. */
  skipPriorityBreakGuard?: boolean;
  /** Emergency: skip 105-min fatigue hard cap. Use only when OT exceeds escalation threshold. */
  skipFatigueHardCap?: boolean;
  /** Club break duration for rest threshold calculation. Defaults to 20 if not provided. */
  clubBreakDurationMinutes?: number;
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

export type SupabaseAdmin = ReturnType<typeof createClient>;

// ─── buildDealerCandidates ────────────────────────────────────────────────────

async function buildDealerCandidates(
  admin: SupabaseAdmin,
  clubId: string,
  options: PickDealerOptions = {}
): Promise<DealerCandidate[]> {
  const {
    tourTier,
    requiredGameTypes,
    currentTableId,
    excludeAttendanceIds = new Set(),
    includeScoreBreakdown,
    clubAvgBreakRatio,
    skipPriorityBreakGuard = false,
    skipFatigueHardCap = false,
    clubBreakDurationMinutes = 20,
  } = options;

  // Step 1: Get active dealer IDs for this club
  const { data: clubDealers } = await admin
    .from("dealers")
    .select("id")
    .eq("club_id", clubId)
    .eq("status", "active");
  const dealerIds = (clubDealers ?? []).map((d: { id: string }) => d.id);
  if (dealerIds.length === 0) return [];

  // Step 1b: Check if requesting table has priority_swing_at set
  // +300 bonus ensures the priority table gets next available dealer.
  let isPrioritySwing = false;
  if (currentTableId) {
    const { data: currentAssignment } = await admin
      .from("dealer_assignments")
      .select("priority_swing_at")
      .eq("table_id", currentTableId)
      .eq("status", "assigned")
      .is("swing_processed_at", null)
      .maybeSingle();
    isPrioritySwing = !!(currentAssignment as any)?.priority_swing_at;
  }

  // Step 2: Query dealer_attendance
  // Include dealers on_break if they've rested >= minimum_break_duration_minutes (default 10).
  // This allows dealers who have completed their minimum break to be pulled back for swing.
  const minBreakMinutes = options.clubBreakDurationMinutes
    ? Math.min(options.clubBreakDurationMinutes, 10)
    : 10;

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
    .eq("status", "checked_in")
    .in("dealer_id", dealerIds)
    .or(`current_state.eq.available,current_state.eq.on_break`);

  if (error) {
    console.error("[pickNextDealer] query error:", error.message);
    return [];
  }

  // Step 3: Query dealer_shift_metrics separately
  const attendanceIds = (rows ?? []).map((r: { id: string }) => r.id);
  const { data: metricsRows } = await admin
    .from("dealer_shift_metrics")
    .select("attendance_id, minutes_since_rest, total_assignments, total_break_minutes, total_worked_minutes")
    .in("attendance_id", attendanceIds);
  const metricsMap = new Map(
    (metricsRows ?? []).map((m: { attendance_id: string; minutes_since_rest: number; total_assignments: number; total_break_minutes: number; total_worked_minutes: number }) => [m.attendance_id, m])
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

  // Step 5: Exclude dealers who are ALREADY BUSY at any table.
  // BUG FIX: Query by dealer_id across ALL attendance records (not just the
  // available list) to catch dealers with duplicate attendance records or
  // orphaned 'assigned'/'pre_assigned'/'in_transition' state from prior shifts.
  // Also excludes dealers who haven't checked out yet regardless of which
  // attendance record shows them busy.
  //
  // 🚨 CRITICAL FIX: Use rolling 24h window to prevent stale records (>1 day old)
  // from poisoning the pool. In tournament poker, shifts cross midnight, so
  // "today" is wrong — 24h rolling window is safe for any shift length.
  const busyDealerIds = new Set<string>();
  const busyWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: busyDealers } = await admin
    .from("dealer_attendance")
    .select("dealer_id")
    .in("dealer_id", dealerIds)
    .in("current_state", ["assigned", "pre_assigned", "in_transition"])
    .is("check_out_time", null)
    .gte("check_in_time", busyWindow);
  for (const bd of busyDealers ?? []) {
    busyDealerIds.add(bd.dealer_id);
  }

  if (busyDealerIds.size > 0) {
    console.log(`[pickNextDealer] Club ${clubId}: ${busyDealerIds.size} dealers excluded as busy (24h window)`);
  }

  // Step 6: Fetch club average break ratio once if needed for equity scoring
  let avgBreakRatio = clubAvgBreakRatio ?? 0.15;
  if (includeScoreBreakdown && avgBreakRatio <= 0 && clubId) {
    const { data: allMetricsRaw } = await admin
      .from("dealer_shift_metrics")
      .select("total_worked_minutes, total_break_minutes")
      .eq("club_id", clubId);
    const totalW = (allMetricsRaw ?? []).reduce(
      (s: number, m: { total_worked_minutes: number }) => s + (m.total_worked_minutes ?? 0), 0
    );
    const totalB = (allMetricsRaw ?? []).reduce(
      (s: number, m: { total_break_minutes: number }) => s + (m.total_break_minutes ?? 0), 0
    );
    if (totalW > 0) avgBreakRatio = totalB / totalW;
  }

  // ── Diagnostics counters (zero-candidate debugging) ────────────────────
  const diag = {
    total_rows: (rows ?? []).length,
    busy_excluded: 0,
    exclude_set_excluded: 0,
    tier_excluded: 0,
    fatigue_excluded: 0,
    priority_break_excluded: 0,
    min_rest_excluded: 0,
    game_type_excluded: 0,
    candidates_count: 0,
  };

  const candidates: DealerCandidate[] = [];

  for (const row of rows ?? []) {
    // ── Intra-cycle exclusion ────────────────────────────────────────────────
    // Accumulative exclusion: dealers picked in earlier phases (Fill, Pass 2)
    // are excluded from later phases (Pass 3). The caller manages the set.
    if (busyDealerIds.has(row.dealer_id)) { diag.busy_excluded++; continue; }
    if (excludeAttendanceIds.has(row.id)) { diag.exclude_set_excluded++; continue; }

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

    // ── On-break minimum rest guard ──────────────────────────────────────────────
    // Dealers on_break are included in the pool query but only eligible if they've
    // rested >= minimum_break_duration_minutes (10). Available dealers always pass.
    if (row.current_state === "on_break" && restMin < minBreakMinutes) {
      diag.min_rest_excluded++;
      continue;
    }

    // ── High-stakes tier guard ─────────────────────────────────────────────
    // HIGH tournaments require A+ tier dealers. Exclude C tier entirely.
    // MEDIUM tournaments prefer B tier but accept A/C.
    if (tourTier === "HIGH" && tier === "C") { diag.tier_excluded++; continue; }

    // ── Fatigue hard cap ────────────────────────────────────────────────────
    // Dealer who hasn't rested enough after a long session needs mandatory rest.
    // Uses restMin (computed from timestamps, never stale) instead of the
    // worked_minutes_since_last_break column. Excluded UNLESS skipFatigueHardCap
    // is set (Level 3 emergency only). When skipped, heavy score penalty applies.
    const fatigueHardCap = consecutive >= 4 && restMin < 10;
    if (!skipFatigueHardCap && fatigueHardCap) { diag.fatigue_excluded++; continue; }

    // ── Priority break + rest guard ─────────────────────────────────────────
    // Dealer flagged for break needs rest — skip unless skipPriorityBreakGuard.
    // Rest threshold = break_duration_minutes + 5 buffer (default 20+5=25).
    // Dealer who rested ≥ threshold is "rested enough" to reassign.
    const restThreshold = (clubBreakDurationMinutes ?? 20) + 5;
    if (!skipPriorityBreakGuard && priorityBreak && restMin < restThreshold) { diag.priority_break_excluded++; continue; }

    // ── Minimum rest ────────────────────────────────────────────────────────
    // Dealer needs ≥10 min rest between swing cycles.
    if (consecutive > 0 && restMin < 10) { diag.min_rest_excluded++; continue; }

    // ── Game type hard-exclude ──────────────────────────────────────────────
    // If the table requires specific game types (e.g., "Omaha", "Mixed"),
    // and the dealer has NONE of those skills → hard exclude.
    if (
      requiredGameTypes &&
      requiredGameTypes.length > 0 &&
      !requiredGameTypes.some((g) => skills.includes(g))
    ) {
      diag.game_type_excluded++;
      continue;
    }

    // ── Scoring ─────────────────────────────────────────────────────────────
    let score = 0;

    // ── On-break penalty ────────────────────────────────────────────────────────
    // Dealers on_break are eligible but deprioritized vs available dealers.
    // They've rested enough but are currently pulled out of rotation.
    if (row.current_state === "on_break") { score -= 50; }
    const breakdown: ScoreBreakdown = {
      rest_bonus: 0, tier_bonus: 0,
      back_to_back_penalty: 0, consecutive_penalty: 0,
      mixed_bonus: 0, skill_bonus: 0,
      priority_break_penalty: 0,
      heavy_worker_penalty: 0, consecutive_high_penalty: 0,
      tier_back_to_back_penalty: 0, break_equity_penalty: 0,
      priority_swing_bonus: 0,
      fatigue_penalty: 0,
    };

    // Rest bonus — prefer well-rested dealers
    if (restMin >= 20) { breakdown.rest_bonus = 200; score += 200; }
    else if (restMin >= 10) { breakdown.rest_bonus = 100; score += 100; }
    else if (restMin >= 5) { breakdown.rest_bonus = 50; score += 50; }

    // Tier bonus — prefer dealers whose tier matches the table
    if (tourTier === "HIGH") {
      if (tier === "A") { breakdown.tier_bonus = 30; score += 30; }
      else if (tier === "B") { breakdown.tier_bonus = 5; score += 5; }
    } else if (tourTier === "MEDIUM") {
      if (tier === "B") { breakdown.tier_bonus = 20; score += 20; }
    } else {
      if (tier === "C") { breakdown.tier_bonus = 20; score += 20; }
    }

    // Consecutive penalty — heavy load is tiring
    if (consecutive >= 3) {
      breakdown.consecutive_penalty = -consecutive * 10;
      score += breakdown.consecutive_penalty;
    }

    // Mixed bonus
    if (skills.includes("Mixed")) { breakdown.mixed_bonus = 2; score += 2; }

    // Skill bonus — +20 per matching game type
    if (requiredGameTypes) {
      for (const g of requiredGameTypes) {
        if (skills.includes(g)) { breakdown.skill_bonus += 20; score += 20; }
      }
    }

    // Priority break penalty — deprioritize dealers who need a break
    if (priorityBreak) {
      breakdown.priority_break_penalty = -500;
      score += breakdown.priority_break_penalty;
    }

    // Heavy worker penalty — avoid repeatedly picking the same dealer
    if (consecutive >= 3) {
      breakdown.heavy_worker_penalty = -10 * (consecutive - 2);
      score += breakdown.heavy_worker_penalty;
    }

    // Consecutive HIGH penalty — rest after HIGH table assignments
    if (tourTier === "HIGH" && lastTourTier === "HIGH") {
      breakdown.consecutive_high_penalty = -20;
      score += breakdown.consecutive_high_penalty;
    }

    // Tier-aware back-to-back penalty — reduced penalty if switching tiers
    if (lastTableId && lastTableId === currentTableId) {
      const sameTier = lastTourTier === tourTier;
      breakdown.tier_back_to_back_penalty = sameTier ? -50 : -25;
      score += breakdown.tier_back_to_back_penalty;
    }

    // ── Break equity penalty ───────────────────────────────────────────────
    // Dealers with below-average break ratio get a small score penalty,
    // making them less likely to be picked for another full swing.
    // This prevents the same dealers from being overworked while others
    // take frequent breaks.
    if (avgBreakRatio > 0 && metric) {
      const dealerBreak = metric.total_break_minutes ?? 0;
      const dealerWorked = metric.total_worked_minutes ?? 0;
      const totalDealerTime = dealerBreak + dealerWorked;
      const dealerRatio = totalDealerTime > 0 ? dealerBreak / totalDealerTime : 0;

      if (dealerRatio < avgBreakRatio * 0.7) {
        // Significant break deficit: -80 penalty
        breakdown.break_equity_penalty = -80;
        score += breakdown.break_equity_penalty;
      } else if (dealerRatio < avgBreakRatio * 0.9) {
        // Moderate break deficit: -30 penalty (gentle nudge)
        breakdown.break_equity_penalty = -30;
        score += breakdown.break_equity_penalty;
      }
    }

    // Priority swing bonus — +300 ensures the priority table gets next available dealer
    if (isPrioritySwing) {
      breakdown.priority_swing_bonus = 300;
      score += 300;
    }

    // ── Fatigue penalty (Level 3 emergency override) ────────────────────────
    // When skipFatigueHardCap is active, dealers who haven't rested enough
    // after 4+ consecutive assignments get a -300 score penalty.
    if (skipFatigueHardCap && fatigueHardCap) {
      breakdown.fatigue_penalty = -300;
      score += breakdown.fatigue_penalty;
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

  diag.candidates_count = candidates.length;

  // Log detailed diagnostics when zero or very few candidates — circuit breaker debugging
  if (candidates.length === 0) {
    console.warn(`[pickNextDealer] ⚠️ Club ${clubId}: ZERO candidates — diagnostics:`, {
      ...diag,
      tourTier: options.tourTier || "(not set)",
      requiredGameTypes: options.requiredGameTypes || "(none)",
      skipPriorityBreakGuard: options.skipPriorityBreakGuard,
      skipFatigueHardCap: options.skipFatigueHardCap,
      busyDealerTotal: busyDealerIds.size,
      busyDealerIds: [...busyDealerIds],
    });
  } else if (candidates.length <= 2) {
    console.log(`[pickNextDealer] ℹ️ Club ${clubId}: ${candidates.length} candidates — diagnostics:`, diag);
  }

  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return candidates;
}

// ─── pickNextDealer ───────────────────────────────────────────────────────────

export async function pickNextDealer(
  admin: SupabaseAdmin,
  clubId: string,
  options: PickDealerOptions = {}
): Promise<DealerCandidate | null> {
  const candidates = await buildDealerCandidates(admin, clubId, options);
  return candidates[0] ?? null;
}

// ─── pickTopDealers ───────────────────────────────────────────────────────────

export async function pickTopDealers(
  admin: SupabaseAdmin,
  clubId: string,
  topN: number,
  options: Omit<PickDealerOptions, "returnTopN"> = {}
): Promise<DealerCandidate[]> {
  const candidates = await buildDealerCandidates(admin, clubId, options);
  return candidates.slice(0, topN);
}

// ─── buildScoreLabel ──────────────────────────────────────────────────────────

export function buildScoreLabel(tier: string, scoreBreakdown: ScoreBreakdown): string {
  const parts: string[] = [];
  if (tier === "A") parts.push("Dealer hạng A ưu tiên");
  else if (tier === "B") parts.push("Hạng B – phù hợp");
  if (scoreBreakdown.rest_bonus >= 200) parts.push("Thời gian nghỉ dài");
  else if (scoreBreakdown.rest_bonus >= 100) parts.push("Nghỉ ngơi đủ");
  if (scoreBreakdown.skill_bonus > 0) parts.push("Có kỹ năng phù hợp");
  if (scoreBreakdown.tier_back_to_back_penalty < 0) parts.push("Tránh bàn cũ");
  if (scoreBreakdown.heavy_worker_penalty < 0) parts.push("Đã làm nhiều swing");
  if (scoreBreakdown.consecutive_high_penalty < 0) parts.push("Nghỉ bàn HIGH");
  if (scoreBreakdown.priority_break_penalty < 0) parts.push("Đến giờ nghỉ");
  if (scoreBreakdown.break_equity_penalty < 0) parts.push("Cần cân bằng nghỉ");
  if (scoreBreakdown.priority_swing_bonus > 0) parts.push("Bàn ưu tiên");
  if (scoreBreakdown.fatigue_penalty < 0) parts.push("Khẩn cấp – mệt nhiều");
  return parts.length ? parts.join(" · ") : "Sẵn sàng";
}
