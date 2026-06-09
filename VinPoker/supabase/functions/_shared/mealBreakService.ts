import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface MealBreakResult {
  ok: boolean;
  error?: string;
  baseDuration?: number;
  bonusMinutes?: number;
  totalDuration?: number;
  breakId?: string;
  alreadyEnded?: boolean;
}

export interface DynamicBreakConfig {
  breakDurationMinutes: number;
  targetRatio: number;
}

export function calculateDynamicBreakDuration(
  activeTables: number,
  availableDealers: number,
  onBreakDealers: number,
  preAssignedDealers: number,
  config: DynamicBreakConfig
): number {
  const weightedPool = availableDealers + preAssignedDealers * 0.5;
  const denominator = weightedPool + onBreakDealers + 0.1;
  const ratio = activeTables / denominator;

  const minFactor = 0.5;
  const maxFactor = 2.0;
  const factor = Math.min(Math.max(ratio / config.targetRatio, minFactor), maxFactor);
  const duration = Math.round(config.breakDurationMinutes / factor);

  return Math.min(Math.max(duration, 10), 45);
}

export async function startMealBreak(
  admin: SupabaseClient,
  attendanceId: string,
  clubId: string,
  dealerId: string
): Promise<MealBreakResult> {
  const now = new Date();

  const { data: att, error: attErr } = await admin
    .from("dealer_attendance")
    .select("id, current_state, status")
    .eq("id", attendanceId)
    .eq("status", "checked_in")
    .single();

  if (attErr || !att) {
    return { ok: false, error: "Không tìm thấy dealer attendance" };
  }

  if (att.current_state !== "available") {
    return { ok: false, error: `Dealer không sẵn sàng (trạng thái: ${att.current_state})` };
  }

  const { data: cfgRow } = await admin
    .from("swing_config")
    .select("break_duration_minutes, target_ratio")
    .eq("club_id", clubId)
    .eq("table_type", "tournament")
    .maybeSingle();

  const baseConfig: DynamicBreakConfig = {
    breakDurationMinutes: cfgRow?.break_duration_minutes ?? 15,
    targetRatio: (cfgRow?.target_ratio ?? 1.2) as number,
  };

  const { data: poolData } = await admin
    .from("dealer_attendance")
    .select("current_state, dealer_id, dealers!inner(club_id)")
    .eq("dealers.club_id", clubId)
    .eq("status", "checked_in");

  const { count: tableCount } = await admin
    .from("game_tables")
    .select("*", { count: "exact", head: true })
    .eq("club_id", clubId)
    .eq("status", "active");

  const available = poolData?.filter((d: any) => d.current_state === "available").length ?? 0;
  const onBreak = poolData?.filter((d: any) => d.current_state === "on_break").length ?? 0;
  const preAssigned = poolData?.filter((d: any) => d.current_state === "pre_assigned").length ?? 0;

  const dynamicDuration = calculateDynamicBreakDuration(
    tableCount ?? 0,
    available,
    onBreak,
    preAssigned,
    baseConfig,
  );

  const BONUS_MINUTES = 15;
  const totalDuration = dynamicDuration + BONUS_MINUTES;

  const { data: breakRecord, error: insertErr } = await admin
    .from("dealer_meal_breaks")
    .insert({
      attendance_id: attendanceId,
      dealer_id: dealerId,
      club_id: clubId,
      break_start: now.toISOString(),
      base_duration_minutes: dynamicDuration,
      bonus_minutes: BONUS_MINUTES,
      total_duration_minutes: totalDuration,
      pool_size_at_start: poolData?.length ?? 0,
      tables_active_at_start: tableCount ?? 0,
      status: "active",
    })
    .select("id")
    .single();

  if (insertErr) {
    if (insertErr.message?.includes("RATE_LIMIT")) {
      return { ok: false, error: "Chỉ được nghỉ ăn cơm 1 lần/7 tiếng." };
    }
    return { ok: false, error: insertErr.message };
  }

  const { data: stateResult } = await admin.rpc("transition_dealer_state", {
    p_attendance_id: attendanceId,
    p_new_state: "on_break",
    p_reason: "meal_break",
  });

  if (stateResult?.ok === false) {
    await admin.from("dealer_meal_breaks").update({ status: "cancelled" }).eq("id", breakRecord.id);
    return { ok: false, error: `State transition failed: ${stateResult.error}` };
  }

  await admin
    .from("dealer_attendance")
    .update({ last_meal_break_at: now.toISOString() })
    .eq("id", attendanceId);

  return {
    ok: true,
    baseDuration: dynamicDuration,
    bonusMinutes: BONUS_MINUTES,
    totalDuration,
    breakId: breakRecord.id,
  };
}

export async function endMealBreak(
  admin: SupabaseClient,
  attendanceId: string,
): Promise<MealBreakResult> {
  const { data: breakRecord, error: updateErr } = await admin
    .from("dealer_meal_breaks")
    .update({
      status: "completed",
      break_end: new Date().toISOString(),
    })
    .eq("attendance_id", attendanceId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();

  if (updateErr) {
    return { ok: false, error: updateErr.message };
  }

  if (!breakRecord) {
    return { ok: true, alreadyEnded: true };
  }

  const { data: stateResult } = await admin.rpc("transition_dealer_state", {
    p_attendance_id: attendanceId,
    p_new_state: "available",
    p_reason: "meal_break_end",
  });

  if (stateResult?.ok === false) {
    await admin.from("dealer_meal_breaks").update({ status: "active" }).eq("id", breakRecord.id);
    return { ok: false, error: `State transition failed: ${stateResult.error}` };
  }

  return { ok: true, alreadyEnded: false };
}

export async function getMealBreakAvailability(
  admin: SupabaseClient,
  attendanceId: string,
): Promise<{ available: boolean; nextAvailableAt: Date | null; currentBreak: any | null }> {
  const { data: att } = await admin
    .from("dealer_attendance")
    .select("id, last_meal_break_at")
    .eq("id", attendanceId)
    .maybeSingle();

  if (!att) {
    return { available: false, nextAvailableAt: null, currentBreak: null };
  }

  const { data: activeBreak } = await admin
    .from("dealer_meal_breaks")
    .select("id, break_start, total_duration_minutes, status")
    .eq("attendance_id", attendanceId)
    .eq("status", "active")
    .maybeSingle();

  if (activeBreak) {
    const endTime = new Date(
      new Date(activeBreak.break_start).getTime() + activeBreak.total_duration_minutes * 60_000,
    );
    return { available: false, nextAvailableAt: endTime, currentBreak: activeBreak };
  }

  const { data: lastCompleted } = await admin
    .from("dealer_meal_breaks")
    .select("break_start, total_duration_minutes")
    .eq("attendance_id", attendanceId)
    .in("status", ["active", "completed"])
    .order("break_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastCompleted) {
    return { available: true, nextAvailableAt: null, currentBreak: null };
  }

  const breakEnd = new Date(
    new Date(lastCompleted.break_start).getTime() + lastCompleted.total_duration_minutes * 60_000,
  );
  const nextAvailable = new Date(breakEnd.getTime() + 7 * 60 * 60 * 1000);

  return {
    available: new Date() >= nextAvailable,
    nextAvailableAt: nextAvailable,
    currentBreak: null,
  };
}