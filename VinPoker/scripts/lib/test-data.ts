import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function createDealer(
  admin: ReturnType<typeof createClient>,
  clubId: string,
) {
  const suffix = randomSuffix();
  const { data, error } = await admin
    .from("dealers")
    .insert({
      club_id: clubId,
      full_name: `Test Dealer ${suffix}`,
      tier: "B",
      status: "active",
      phone: `09${suffix}`,
    })
    .select("id, full_name, tier")
    .single();

  if (error) throw new Error(`createDealer failed: ${error.message}`);
  return data;
}

export async function createGameTable(
  admin: ReturnType<typeof createClient>,
  clubId: string,
  shiftId?: string,
) {
  const suffix = randomSuffix();
  const { data, error } = await admin
    .from("game_tables")
    .insert({
      club_id: clubId,
      table_name: `Test Bàn ${suffix}`,
      table_type: "tournament",
      tour_tier: "MEDIUM",
      status: "active",
      shift_id: shiftId ?? null,
    })
    .select("id, table_name, tour_tier")
    .single();

  if (error) throw new Error(`createGameTable failed: ${error.message}`);
  return data;
}

export async function createAttendance(
  admin: ReturnType<typeof createClient>,
  dealerId: string,
  shiftId?: string,
) {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await admin
    .from("dealer_attendance")
    .insert({
      dealer_id: dealerId,
      shift_date: today,
      status: "checked_in",
      current_state: "available",
      check_in_time: new Date().toISOString(),
      shift_id: shiftId ?? null,
      worked_minutes_since_last_break: 0,
    })
    .select("id, dealer_id, current_state, status")
    .single();

  if (error) throw new Error(`createAttendance failed: ${error.message}`);
  return data;
}

export async function ensureSwingConfig(
  admin: ReturnType<typeof createClient>,
  clubId: string,
) {
  const { data: existing } = await admin
    .from("swing_config")
    .select("id")
    .eq("club_id", clubId)
    .eq("table_type", "tournament")
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await admin
    .from("swing_config")
    .insert({
      club_id: clubId,
      table_type: "tournament",
      swing_duration_minutes: 30,
      break_duration_minutes: 15,
      pre_announce_minutes: 10,
    })
    .select("id")
    .single();

  if (error) throw new Error(`ensureSwingConfig failed: ${error.message}`);
  return data;
}

export async function cleanupTestData(
  admin: ReturnType<typeof createClient>,
  dealerId: string,
  tableId?: string,
) {
  // Xóa attendances của dealer
  await admin.from("dealer_attendance").delete().eq("dealer_id", dealerId);

  // Xóa dealer
  await admin.from("dealers").delete().eq("id", dealerId);

  // Xóa game table nếu có
  if (tableId) {
    await admin.from("game_tables").delete().eq("id", tableId);
  }
}
