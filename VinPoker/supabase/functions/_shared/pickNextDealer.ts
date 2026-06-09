/**
 * _shared/pickNextDealer.ts
 *
 * Dealer selection with scoring, game-type matching, break equity penalty,
 * intra-cycle exclusion, and high-stakes tier guard.
 *
 * Key scoring components:
 *  - rest_bonus: more rest â†’ higher score
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

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  /** Minimum rest minutes between consecutive assignments. Defaults to 10 if not provided.
   *  Used by graduated escalation: Tier 1=5, Tier 2=3, Tier 3=0 to relax rest enforcement. */
  minRestMinutes?: number;
  /** Minimum rest minutes between two swing assignments (inter-swing cooldown).
   *  0 = disabled. Defaults to 10. Based on last_released_at timestamp. */
  minInterSwingRestMinutes?: number;
  /** When set, the cooldown check uses this future timestamp (swing_due_at) instead of
   *  Date.now(). This allows Pass 2 to pre-assign a dealer who will complete their rest
   *  before the swing due time, even if they aren't available at this exact moment.
   *  Clamped to max 15 minutes ahead to prevent forward-looking anomalies. */
  swingDueAt?: string;
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
  current_state: "available" | "on_break";
  last_tour_tier: string;
  score?: number;
  score_breakdown?: ScoreBreakdown;
}

export interface BuildCandidatesResult {
  candidates: DealerCandidate[];
  avgBreakRatio: number | null;
}

export type SupabaseAdmin = ReturnType<typeof createClient>;

interface AttendancePoolRow {
  id: string;
  dealer_id: string;
  current_state: string;
  status: string;
  worked_minutes_since_last_break: number | null;
  priority_break_flag: boolean | null;
  last_released_at: string | null;
  check_in_time: string | null;
  dealers: {
    full_name: string;
    telegram_username: string | null;
    telegram_user_id: string | null;
    tier: "A" | "B" | "C" | null;
    skills: string[] | null;
  };
}

interface ActiveBreakRow {
  assignment_id: string;
  break_start: string;
}

function pickPreferredAttendanceRow(
  current: AttendancePoolRow | undefined,
  candidate: AttendancePoolRow
): AttendancePoolRow {
  if (!current) return candidate;

  const currentCheckIn = current.check_in_time ? new Date(current.check_in_time).getTime() : 0;
  const candidateCheckIn = candidate.check_in_time ? new Date(candidate.check_in_time).getTime() : 0;
  if (candidateCheckIn !== currentCheckIn) {
    return candidateCheckIn > currentCheckIn ? candidate : current;
  }

  const currentReleased = current.last_released_at ? new Date(current.last_released_at).getTime() : 0;
  const candidateReleased = candidate.last_released_at ? new Date(candidate.last_released_at).getTime() : 0;
  if (candidateReleased !== currentReleased) {
    return candidateReleased > currentReleased ? candidate : current;
  }

  const currentAvailable = current.current_state === "available" ? 1 : 0;
  const candidateAvailable = candidate.current_state === "available" ? 1 : 0;
  if (candidateAvailable !== currentAvailable) {
    return candidateAvailable > currentAvailable ? candidate : current;
  }

  return candidate.id.localeCompare(current.id) > 0 ? candidate : current;
}

// â”€â”€â”€ buildDealerCandidates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function buildDealerCandidates(
  admin: SupabaseAdmin,
  clubId: string,
  options: PickDealerOptions = {}
): Promise<BuildCandidatesResult> {
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
    minRestMinutes = 10,
    minInterSwingRestMinutes: rawMinInterSwingRestMinutes = 10,
    swingDueAt,
  } = options;
  const minInterSwingRestMinutes =
    rawMinInterSwingRestMinutes === 0 ? 0 : Math.max(10, rawMinInterSwingRestMinutes);

  // Step 1: Get active dealer IDs for this club
  const { data: clubDealers } = await admin
    .from("dealers")
    .select("id")
    .eq("club_id", clubId)
    .eq("status", "active");
  const dealerIds = (clubDealers ?? []).map((d: { id: string }) => d.id);
  // Step 1 edge case: no dealers â†’ return empty with null avgBreakRatio
  if (dealerIds.length === 0) return { candidates: [], avgBreakRatio: null };

  // Step 1b: Check if requesting table has priority_swing_at set

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
  // Dealers on_break must rest the full configured break duration before
  // they can be pulled back for swing. This protects lunch breaks (e.g. 30min).
  // Available dealers always pass this guard since they're not on_break.
  const minBreakMinutes = options.clubBreakDurationMinutes ?? 15;

  const { data: rawRows, error } = await admin
    .from("dealer_attendance")
    .select(
      `id, dealer_id, current_state, status,
        worked_minutes_since_last_break, priority_break_flag,
        check_in_time, last_released_at,
        dealers!inner(
          full_name, telegram_username, telegram_user_id,
          tier, skills
        )`
    )
    .eq("status", "checked_in")
    .in("dealer_id", dealerIds)
    .or(`current_state.eq.available,current_state.eq.on_break`);

  // Step 2 edge case: query error or empty rows
  if (error) {
    console.error("[pickNextDealer] query error:", error.message);
    return { candidates: [], avgBreakRatio: null };
  }

  const rowsByDealer = new Map<string, AttendancePoolRow>();
  let duplicateDealerRows = 0;
  for (const row of (rawRows ?? []) as AttendancePoolRow[]) {
    const current = rowsByDealer.get(row.dealer_id);
    if (!current) {
      rowsByDealer.set(row.dealer_id, row);
      continue;
    }
    const preferred = pickPreferredAttendanceRow(current, row);
    if (preferred !== current) {
      rowsByDealer.set(row.dealer_id, preferred);
    }
    duplicateDealerRows++;
  }
  const rows = [...rowsByDealer.values()];
  if (duplicateDealerRows > 0) {
    console.warn(
      `[pickNextDealer] Club ${clubId}: deduped ${duplicateDealerRows} duplicate active attendance row(s) ` +
      `across ${rows.length} dealer(s)`
    );
  }

  // Step 3: Query dealer_shift_metrics separately
  const attendanceIds = rows.map((r) => r.id);
  const nowMs = Date.now();
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

  const activeBreakMap = new Map<string, string>();
  if (attendanceIds.length > 0) {
    const { data: attendanceAssignments } = await admin
      .from("dealer_assignments")
      .select("id, attendance_id")
      .in("attendance_id", attendanceIds);
    const attendanceAssignmentIds = (attendanceAssignments ?? []).map((a: { id: string; attendance_id: string }) => a.id);
    if (attendanceAssignmentIds.length > 0) {
      const { data: activeBreakRows } = await admin
        .from("dealer_breaks")
        .select("assignment_id, break_start")
        .is("break_end", null)
        .in("assignment_id", attendanceAssignmentIds);
      const activeBreakAssignmentIds = new Set((activeBreakRows ?? []).map((r: ActiveBreakRow) => r.assignment_id));
      if (activeBreakAssignmentIds.size > 0) {
        for (const row of (activeBreakRows ?? []) as ActiveBreakRow[]) {
          const assignment = (attendanceAssignments ?? []).find((a: { id: string; attendance_id: string }) => a.id === row.assignment_id);
          if (assignment && !activeBreakMap.has(assignment.attendance_id)) {
            activeBreakMap.set(assignment.attendance_id, row.break_start);
          }
        }
      }
    }
  }

  // Step 5: Exclude dealers who are ALREADY BUSY at any table.
  // BUG FIX: Query by dealer_id across ALL attendance records (not just the
  // available list) to catch dealers with duplicate attendance records or
  // orphaned 'assigned'/'pre_assigned'/'in_transition' state from prior shifts.
  // Also excludes dealers who haven't checked out yet regardless of which
  // attendance record shows them busy.
  //
  // ðŸš¨ CRITICAL FIX: Use rolling 24h window to prevent stale records (>1 day old)
  // from poisoning the pool. In tournament poker, shifts cross midnight, so
  // "today" is wrong â€” 24h rolling window is safe for any shift length.
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
  const diag = {
    total_rows: rows.length,
    duplicate_dealer_rows: duplicateDealerRows,
    busy_excluded: 0,
    exclude_set_excluded: 0,
    tier_excluded: 0,
    fatigue_excluded: 0,
    priority_break_excluded: 0,
    min_rest_excluded: 0,
    on_break_excluded: 0,
    inter_swing_cooldown_excluded: 0,
    game_type_excluded: 0,
    meal_break_excluded: 0,
    step5b_pre_assigned_refs: 0,
    step5c_pre_assigned: 0,
    candidates_count: 0,
  };


  // Step 5b: Cross-check dealer_assignments for dealers that appear available
  // or on_break in dealer_attendance but actually have active assignments at a
  // different table (B6 defense). Includes on_break and pre_assigned statuses.
  // Table-aware: excludes assignments at currentTableId since dealer on_break
  // at the table being picked for is valid (they'll be replaced).
  // TODO: Add advisory lock per-dealer to prevent race condition when 2 tables
  // pick the same dealer concurrently (Bug A â€” club-level lock is sufficient for now).
  if (dealerIds.length > 0) {
    let busyAssignmentsQuery = admin
      .from("dealer_assignments")
      .select("dealer_id, table_id, status")
      .in("dealer_id", dealerIds)
      .in("status", ["assigned", "pre_assigned", "on_break"])
      .is("released_at", null);

    if (currentTableId) {
      busyAssignmentsQuery = busyAssignmentsQuery.neq("table_id", currentTableId);
    } else {
      console.warn(
        `[pickNextDealer] Club ${clubId}: currentTableId not provided â€” ` +
        `table-aware guard disabled. Verify excludeAttendanceIds covers current table dealers.`
      );
    }

    const { data: busyAssignments } = await busyAssignmentsQuery;

    for (const ba of busyAssignments ?? []) {
      busyDealerIds.add(ba.dealer_id);
    }

    if (busyAssignments && busyAssignments.length > 0) {
      console.log(
        `[pickNextDealer] Club ${clubId}: ${busyAssignments.length} dealers excluded by assignment cross-check (Step 5b)` +
        (currentTableId ? ` [table-aware: excluding table ${currentTableId}]` : " [no table-aware filter]")
      );
    }

    // â”€â”€ Step 5b-ext: Check pre_assigned_attendance_id references â”€â”€
    // A dealer's attendance_id may be referenced as pre_assigned_attendance_id
    // in another active assignment. This catches the gap where pre-assign RPC
    // sets dealer_attendance.state='pre_assigned' but doesn't create an assignment
    // record for the incoming dealer.
    const { data: preAssignedRefs } = await admin
      .from("dealer_assignments")
      .select("pre_assigned_attendance_id")
      .in("pre_assigned_attendance_id", attendanceIds)
      .in("status", ["assigned", "on_break"])
      .is("released_at", null);

    const preAssignedRefIds = new Set(
      (preAssignedRefs ?? []).map((r) => r.pre_assigned_attendance_id)
    );

    for (const row of rows) {
      if (preAssignedRefIds.has(row.id)) {
        if (!busyDealerIds.has(row.dealer_id)) {
          diag.step5b_pre_assigned_refs++;
          console.warn(
            `[pickNextDealer] Step 5b-ext: Dealer ${row.dealer_id} excluded ` +
            `(attendance ${row.id} referenced as pre_assigned_attendance_id in another active assignment)`
          );
        }
        busyDealerIds.add(row.dealer_id);
      }
    }

    if (diag.step5b_pre_assigned_refs > 0) {
      console.log(
        `[pickNextDealer] Club ${clubId}: ${diag.step5b_pre_assigned_refs} dealers ` +
        `excluded by Step 5b-ext (pre_assigned_attendance_id reference)`
      );
    }
  }

  // â”€â”€ Step 5c: Safety net â€” catch pre_assigned dealers without assignment record â”€â”€
  // Pre-assign RPC sets dealer_attendance.current_state='pre_assigned' but does NOT
  // create a dealer_assignments record. Step 5b misses them. This catches the gap.
  const { data: preAssignedDealers } = await admin
    .from("dealer_attendance")
    .select("dealer_id, id, pre_assigned_table_id")
    .in("dealer_id", dealerIds)
    .eq("current_state", "pre_assigned")
    .is("check_out_time", null);

  for (const pad of preAssignedDealers ?? []) {
    if (!busyDealerIds.has(pad.dealer_id)) {
      diag.step5c_pre_assigned++;
      console.warn(
        `[pickNextDealer] Step 5c: Dealer ${pad.dealer_id} excluded ` +
        `(attendance ${pad.id} pre_assigned to table ${pad.pre_assigned_table_id}, ` +
        `no assignment record yet)`
      );
    }
    busyDealerIds.add(pad.dealer_id);
  }

  if (diag.step5c_pre_assigned > 0) {
    console.log(
      `[pickNextDealer] Club ${clubId}: ${diag.step5c_pre_assigned} dealers ` +
      `excluded by Step 5c (pre_assigned without assignment record)`
    );
  }

  // Step 6: Fetch club average break ratio once if needed for equity scoring
  // null = insufficient data â†’ skip break equity penalty entirely
  let avgBreakRatio: number | null = clubAvgBreakRatio ?? null;
  if (includeScoreBreakdown && avgBreakRatio === null && clubId) {
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

  // â”€â”€ Meal break exclusion (defense-in-depth) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Dealers currently in an active meal break must NOT be picked, even if
  // state transition hasn't happened yet (cron delay).
  const { data: activeMealBreaks } = await admin
    .from("dealer_meal_breaks")
    .select("attendance_id, break_start, total_duration_minutes")
    .in("attendance_id", attendanceIds)
    .eq("status", "active");

  const now = Date.now();
  const mealBreakExcludedIds = new Set<string>();
  for (const mb of activeMealBreaks ?? []) {
    const elapsed = (now - new Date(mb.break_start).getTime()) / 60_000;
    if (elapsed < mb.total_duration_minutes) {
      mealBreakExcludedIds.add(mb.attendance_id);
    }
  }


  const candidates: DealerCandidate[] = [];

  for (const row of rows) {
    // â”€â”€ Intra-cycle exclusion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Accumulative exclusion: dealers picked in earlier phases (Fill, Pass 2)
    // are excluded from later phases (Pass 3). The caller manages the set.
    if (busyDealerIds.has(row.dealer_id)) { diag.busy_excluded++; continue; }
    if (excludeAttendanceIds.has(row.id)) { diag.exclude_set_excluded++; continue; }

    // â”€â”€ Meal break exclusion (defense-in-depth) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (mealBreakExcludedIds.has(row.id)) { diag.meal_break_excluded++; continue; }

    // â”€â”€ Emergency pre-assign guard (defense-in-depth) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Dealers already emergency-pre-assigned to another table must NOT be picked.
    // This is redundant with busyDealerIds (Step 5 queries pre_assigned) but
    // protects against race conditions if state hasn't propagated yet.
    if (row.current_state === "pre_assigned") {
      diag.busy_excluded++;
      console.warn(`[pickNextDealer] Dealer ${row.dealer_id} skipped: current_state=pre_assigned`);
      continue;
    }

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

    // â”€â”€ On-break minimum rest guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Dealers on_break are NOT eligible while they still have an active break
    // record (break_end IS NULL) — the break must be explicitly ended first,
    // regardless of how long it has been running.
    // Fallback: if the break record is missing/stale, use computed restMin.
    if (row.current_state === "on_break") {
      const activeBreakTimestamp = activeBreakMap.get(row.id) ?? null;

      if (activeBreakTimestamp !== null) {
        diag.on_break_excluded++;
        continue;
      }

      if (restMin < minBreakMinutes) {
        console.warn(
          `[ANOMALY] Dealer ${row.id}: state=on_break, no break record. ` +
          `Excluded (restMin=${restMin.toFixed(1)}m < minBreak=${minBreakMinutes}m)`
        );
        diag.min_rest_excluded++;
        continue;
      }
    }

    // â”€â”€ High-stakes tier guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // HIGH tournaments require A+ tier dealers. Exclude C tier entirely.
    // MEDIUM tournaments prefer B tier but accept A/C.
    if (tourTier === "HIGH" && tier === "C") { diag.tier_excluded++; continue; }

    // â”€â”€ Fatigue hard cap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Dealer who hasn't rested enough after a long session needs mandatory rest.
    // Uses restMin (computed from timestamps, never stale) instead of the
    // worked_minutes_since_last_break column. Excluded UNLESS skipFatigueHardCap
    // is set (Level 3 emergency only). When skipped, heavy score penalty applies.
    const fatigueHardCap = consecutive >= 4 && restMin < 10;
    if (!skipFatigueHardCap && fatigueHardCap) { diag.fatigue_excluded++; continue; }

    // â”€â”€ Priority break + rest guard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Dealer flagged for break needs rest â€” skip unless skipPriorityBreakGuard.
    // Rest threshold = break_duration_minutes + 5 buffer (default 20+5=25).
    // Dealer who rested â‰¥ threshold is "rested enough" to reassign.
    const restThreshold = (clubBreakDurationMinutes ?? 20) + 5;
    if (!skipPriorityBreakGuard && priorityBreak && restMin < restThreshold) { diag.priority_break_excluded++; continue; }

    // â”€â”€ Inter-swing rest cooldown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Dealer who just left a table must rest â‰¥ minInterSwingRestMinutes
    // before being picked for another swing. Uses last_released_at timestamp.
    // NULL = never released (first shift) or just finished break â†’ eligible.
    // Math.floor avoids floating-point edge case (e.g. 9.999 < 10).
    if (minInterSwingRestMinutes > 0 && (row.current_state === "available" || row.current_state === "on_break")) {
      let referenceTime = Date.now();
      if (swingDueAt) {
        const swingTime = new Date(swingDueAt).getTime();
        const maxLookahead = Date.now() + 15 * 60_000;
        referenceTime = Math.min(swingTime, maxLookahead);
        if (swingTime > maxLookahead) {
          console.warn(
            `[ANOMALY] swingDueAt too far in future: ${swingDueAt}, clamping to +15min`
          );
        }
      }
      const SAFETY_BUFFER_MINUTES = 0.25;
      const releasedAt = (row as any).last_released_at;
      if (releasedAt) {
        const minutesSinceRelease = Math.floor(
          (referenceTime - new Date(releasedAt).getTime()) / 60_000
        );
        const effectiveRest = minInterSwingRestMinutes + SAFETY_BUFFER_MINUTES;
        if (minutesSinceRelease < effectiveRest) {
          diag.inter_swing_cooldown_excluded++;
          console.log(
            `[pickNextDealer] Cooldown: dealer ${row.dealer_id} excluded — waited ${minutesSinceRelease}m/${effectiveRest.toFixed(1)}m (reference: ${swingDueAt ? 'swing_due_at' : 'now'}), remaining ${(effectiveRest - minutesSinceRelease).toFixed(1)}m`
          );
          continue;
        }
        if (swingDueAt) {
          const nowMinutes = (Date.now() - new Date(releasedAt).getTime()) / 60_000;
          if (nowMinutes < minInterSwingRestMinutes) {
            console.log(
              `[PREDICTIVE] Dealer ${row.dealer_id}: now=${nowMinutes.toFixed(1)}m < min=${minInterSwingRestMinutes}m, but swing_due_at=${swingDueAt} → eligible`
            );
          }
        }
      }
    }
      }
    }

    // â”€â”€ Minimum rest â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Dealer needs â‰¥N min rest between swing cycles. Default 10 min, but
    // graduated escalation can lower this (Tier 1=5, Tier 2=3, Tier 3=0)
    // when a stuck assignment needs aggressive recovery.
    if (consecutive > 0 && restMin < minRestMinutes) { diag.min_rest_excluded++; continue; }

    // â”€â”€ Soft cap warning (log only, do not block) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Issue 6: track high-consecutive dealers for admin review. Fire-and-forget
    // so the scoring loop isn't blocked by an insert. clubId is in scope from
    // buildDealerCandidates param (line 87). Warning only, no hard cap (P2).
    if (consecutive >= 4) {
      admin.from("diagnostic_logs").insert({
        club_id: clubId,
        diagnostic_type: "high_consecutive_warning",
        result: {
          attendance_id: row.id,
          dealer_id: row.dealer_id,
          dealer_name: d.full_name,
          consecutive_swings: consecutive,
          rest_minutes: restMin,
        },
        metadata: {
          table_id: currentTableId,
          tournament_tier: tourTier,
        },
      }).then(({ error }) => {
        if (error) console.warn("[soft-cap] log failed:", error.message);
      });
    }

    // â”€â”€ Game type hard-exclude â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // If the table requires specific game types (e.g., "Omaha", "Mixed"),
    // and the dealer has NONE of those skills â†’ hard exclude.
    if (
      requiredGameTypes &&
      requiredGameTypes.length > 0 &&
      !requiredGameTypes.some((g) => skills.includes(g))
    ) {
      diag.game_type_excluded++;
      continue;
    }

    // â”€â”€ Scoring â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let score = 0;

    // â”€â”€ On-break penalty â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Rest bonus â€” prefer well-rested dealers
    if (restMin >= 20) { breakdown.rest_bonus = 200; score += 200; }
    else if (restMin >= 10) { breakdown.rest_bonus = 100; score += 100; }
    else if (restMin >= 5) { breakdown.rest_bonus = 50; score += 50; }

    // Tier bonus â€” prefer dealers whose tier matches the table
    if (tourTier === "HIGH") {
      if (tier === "A") { breakdown.tier_bonus = 30; score += 30; }
      else if (tier === "B") { breakdown.tier_bonus = 5; score += 5; }
    } else if (tourTier === "MEDIUM") {
      if (tier === "B") { breakdown.tier_bonus = 20; score += 20; }
    } else {
      if (tier === "C") { breakdown.tier_bonus = 20; score += 20; }
    }

    // Consecutive penalty â€” heavy load is tiring
    if (consecutive >= 3) {
      breakdown.consecutive_penalty = -consecutive * 10;
      score += breakdown.consecutive_penalty;
    }

    // Mixed bonus
    if (skills.includes("Mixed")) { breakdown.mixed_bonus = 2; score += 2; }

    // Skill bonus â€” +20 per matching game type
    if (requiredGameTypes) {
      for (const g of requiredGameTypes) {
        if (skills.includes(g)) { breakdown.skill_bonus += 20; score += 20; }
      }
    }

    // Priority break penalty â€” deprioritize dealers who need a break
    if (priorityBreak) {
      breakdown.priority_break_penalty = -500;
      score += breakdown.priority_break_penalty;
    }

    // Heavy worker penalty â€” avoid repeatedly picking the same dealer
    if (consecutive >= 3) {
      breakdown.heavy_worker_penalty = -10 * (consecutive - 2);
      score += breakdown.heavy_worker_penalty;
    }

    // Consecutive HIGH penalty â€” rest after HIGH table assignments
    if (tourTier === "HIGH" && lastTourTier === "HIGH") {
      breakdown.consecutive_high_penalty = -20;
      score += breakdown.consecutive_high_penalty;
    }

    // Tier-aware back-to-back penalty â€” reduced penalty if switching tiers
    if (lastTableId && lastTableId === currentTableId) {
      const sameTier = lastTourTier === tourTier;
      breakdown.tier_back_to_back_penalty = sameTier ? -50 : -25;
      score += breakdown.tier_back_to_back_penalty;
    }

    // â”€â”€ Break equity penalty â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Dealers with below-average break ratio get a small score penalty,
    // making them less likely to be picked for another full swing.
    // avgBreakRatio === null means insufficient data â†’ skip entirely.
    if (avgBreakRatio !== null && avgBreakRatio > 0 && metric) {
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

    // Priority swing bonus â€” +300 ensures the priority table gets next available dealer
    if (isPrioritySwing) {
      breakdown.priority_swing_bonus = 300;
      score += 300;
    }

    // â”€â”€ Fatigue penalty (Level 3 emergency override) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      current_state: row.current_state as "available" | "on_break",
      last_tour_tier: lastTourTier,
      score,
    };

    if (includeScoreBreakdown) {
      candidate.score_breakdown = breakdown;
    }

    candidates.push(candidate);
  }

  diag.candidates_count = candidates.length;

  // Log detailed diagnostics when zero or very few candidates â€” circuit breaker debugging
  if (candidates.length === 0) {
    console.warn(`[pickNextDealer] âš ï¸ Club ${clubId}: ZERO candidates â€” diagnostics:`, {
      ...diag,
      tourTier: options.tourTier || "(not set)",
      requiredGameTypes: options.requiredGameTypes || "(none)",
      skipPriorityBreakGuard: options.skipPriorityBreakGuard,
      skipFatigueHardCap: options.skipFatigueHardCap,
      minRestMinutes: options.minRestMinutes ?? 10,
      minInterSwingRestMinutes: options.minInterSwingRestMinutes ?? 10,
      busyDealerTotal: busyDealerIds.size,
      busyDealerIds: [...busyDealerIds],
    });
  } else if (candidates.length <= 2) {
    console.log(`[pickNextDealer] â„¹ï¸ Club ${clubId}: ${candidates.length} candidates â€” diagnostics:`, diag);
  }

  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { candidates, avgBreakRatio };
}

// â”€â”€â”€ pickNextDealer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function pickNextDealer(
  admin: SupabaseAdmin,
  clubId: string,
  options: PickDealerOptions = {}
): Promise<DealerCandidate | null> {
  const { candidates } = await buildDealerCandidates(admin, clubId, options);
  return candidates[0] ?? null;
}

// â”€â”€â”€ pickTopDealers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function pickTopDealers(
  admin: SupabaseAdmin,
  clubId: string,
  topN: number,
  options: Omit<PickDealerOptions, "returnTopN"> = {}
): Promise<DealerCandidate[]> {
  const { candidates } = await buildDealerCandidates(admin, clubId, options);
  return candidates.slice(0, topN);
}

// â”€â”€â”€ buildScoreLabel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function buildScoreLabel(tier: string, scoreBreakdown: ScoreBreakdown): string {
  const parts: string[] = [];
  if (tier === "A") parts.push("Dealer háº¡ng A Æ°u tiÃªn");
  else if (tier === "B") parts.push("Háº¡ng B â€“ phÃ¹ há»£p");
  if (scoreBreakdown.rest_bonus >= 200) parts.push("Thá»i gian nghá»‰ dÃ i");
  else if (scoreBreakdown.rest_bonus >= 100) parts.push("Nghá»‰ ngÆ¡i Ä‘á»§");
  if (scoreBreakdown.skill_bonus > 0) parts.push("CÃ³ ká»¹ nÄƒng phÃ¹ há»£p");
  if (scoreBreakdown.tier_back_to_back_penalty < 0) parts.push("TrÃ¡nh bÃ n cÅ©");
  if (scoreBreakdown.heavy_worker_penalty < 0) parts.push("ÄÃ£ lÃ m nhiá»u swing");
  if (scoreBreakdown.consecutive_high_penalty < 0) parts.push("Nghá»‰ bÃ n HIGH");
  if (scoreBreakdown.priority_break_penalty < 0) parts.push("Äáº¿n giá» nghá»‰");
  if (scoreBreakdown.break_equity_penalty < 0) parts.push("Cáº§n cÃ¢n báº±ng nghá»‰");
  if (scoreBreakdown.priority_swing_bonus > 0) parts.push("BÃ n Æ°u tiÃªn");
  if (scoreBreakdown.fatigue_penalty < 0) parts.push("Kháº©n cáº¥p â€“ má»‡t nhiá»u");
  return parts.length ? parts.join(" Â· ") : "Sáºµn sÃ ng";
}
