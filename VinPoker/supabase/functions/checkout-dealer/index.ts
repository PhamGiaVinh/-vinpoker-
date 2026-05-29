import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, jsonResponse } from "../_shared/dealer-utils.ts";
import {
  sendTelegramNotification, getClubTelegramChatId,
} from "../_shared/telegram.ts";

function decodeJWT(token: string): { sub: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

async function processOneCheckout(
  admin: ReturnType<typeof createClient>,
  botToken: string,
  uid: string,
  attendanceId: string,
): Promise<Record<string, unknown>> {
  // 1. Get attendance info + club_id for auth check
  const { data: att, error: attErr } = await admin
    .from("dealer_attendance")
    .select(`
      id, dealer_id, status, current_state, shift_id, check_in_time,
      pre_assigned_table_id,
      dealers!inner(id, full_name, club_id)
    `)
    .eq("id", attendanceId)
    .single();

  if (attErr) return { attendance_id: attendanceId, success: false, error: `DB error: ${attErr.message}` };
  if (!att) return { attendance_id: attendanceId, success: false, error: "Attendance not found" };
  if (att.status !== "checked_in") {
    return { attendance_id: attendanceId, success: false, error: "Dealer không trong trạng thái check-in" };
  }

  const clubId = (att as any).dealers.club_id;
  const dealerName = (att as any).dealers.full_name;
  const checkInTime = (att as any).check_in_time;

  // Auth check for first item only (caller already verified for this club)
  // All items in a batch are expected to belong to the same club

  let releasedPreAssigned = false;
  let preAssignedTableName: string | null = null;
  let preAssignedDealerName: string | null = null;

  // 2. Atomic cleanup: release pre_assigned nếu dealer đang ở state pre_assigned
  const wasPreAssigned = (att as any).current_state === "pre_assigned";

  if (wasPreAssigned) {
    preAssignedDealerName = dealerName;

    // Get table name trước khi cleanup
    const { data: tableInfo } = await admin
      .from("game_tables")
      .select("table_name")
      .eq("id", (att as any).pre_assigned_table_id)
      .maybeSingle();
    preAssignedTableName = tableInfo?.table_name ?? null;

    // Cleanup dealer_attendance
    await admin
      .from("dealer_attendance")
      .update({
        current_state: "available",
        pre_assigned_table_id: null,
        pre_assigned_at: null,
      })
      .eq("id", attendanceId)
      .eq("current_state", "pre_assigned");

    // Cleanup dealer_assignments
    await admin
      .from("dealer_assignments")
      .update({
        pre_assigned_attendance_id: null,
        pre_assigned_at: null,
      })
      .eq("pre_assigned_attendance_id", attendanceId)
      .eq("status", "assigned");

    releasedPreAssigned = true;
  }

  // ── Compute overtime minutes at checkout ──────────────────────────
  // TODO: move STANDARD_SHIFT_MINUTES to club_settings for per-club configurability
  const STANDARD_SHIFT_MINUTES = 480;

  let overtimeMinutes = 0;
  let workedMinutes = 0;
  let totalHours = 0;

  if (!checkInTime) {
    console.error(`[checkout-dealer] attendance ${attendanceId} has no check_in_time — skipping OT computation`);
  } else {
    const checkInMs = new Date(checkInTime).getTime();
    const nowMs = Date.now();
    const totalMinutes = Math.round((nowMs - checkInMs) / 60000);

    // Subtract break time (dealer_breaks has assignment_id → dealer_assignments.id → attendance_id)
    const { data: assignments } = await admin
      .from("dealer_assignments")
      .select("id")
      .eq("attendance_id", attendanceId);
    const assignmentIds = (assignments ?? []).map((a: { id: string }) => a.id);

    const { data: breaks } = await admin
      .from("dealer_breaks")
      .select("break_start, break_end")
      .in("assignment_id", assignmentIds)
      .not("break_end", "is", null);

    const totalBreakMinutes = (breaks ?? []).reduce((sum: number, b: { break_start: string; break_end: string }) => {
      const duration = Math.round(
        (new Date(b.break_end).getTime() - new Date(b.break_start).getTime()) / 60000
      );
      return sum + Math.max(duration, 0);
    }, 0);

    workedMinutes = totalMinutes - totalBreakMinutes;
    overtimeMinutes = Math.max(0, workedMinutes - STANDARD_SHIFT_MINUTES);
    totalHours = Math.round(workedMinutes / 6) / 10;
  }

  // 3. Check-out chính
  const nowISO = new Date().toISOString();
  await admin
    .from("dealer_attendance")
    .update({
      status: "checked_out",
      check_out_time: nowISO,
      current_state: "checked_out",
      pre_assigned_table_id: null,
      pre_assigned_at: null,
      overtime_minutes: overtimeMinutes,
      worked_minutes_since_last_break: workedMinutes,
    })
    .eq("id", attendanceId);

  const fmtTime = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  // 4. Telegram: gửi thông báo checkout tới group chat
  if (botToken) {
    try {
      const groupChatId = await getClubTelegramChatId(admin, clubId);
      if (groupChatId) {
        const checkInStr = checkInTime ? fmtTime(new Date(checkInTime)) : "?";
        const checkOutStr = fmtTime(new Date(nowISO));
        const msg = `Dealer ${dealerName} check out - thời gian làm việc ${checkInStr}-${checkOutStr}: ${totalHours} tiếng`;
        await sendTelegramNotification(botToken, groupChatId, msg).catch(() => {});
      }
    } catch { /* non-critical */ }

    // If pre_assigned → also send alerts (existing behavior)
    if (releasedPreAssigned) {
      const { data: cs } = await admin
        .from("club_settings")
        .select("floor_manager_chat_id")
        .eq("club_id", clubId)
        .maybeSingle();

      const fmChatId = (cs as any)?.floor_manager_chat_id;
      if (fmChatId) {
        await sendTelegramNotification(botToken, fmChatId,
          `🚨 *Check-out đột ngột!*\n\n${preAssignedDealerName} (đang pre_assigned cho bàn ${preAssignedTableName ?? "N/A"}) vừa check-out.\nCần gán dealer mới cho bàn này!`,
          { logError: (err) => console.error("checkout FM alert error:", err) }
        ).catch(() => {});
      }

      const groupChatId2 = await getClubTelegramChatId(admin, clubId);
      if (groupChatId2) {
        await sendTelegramNotification(botToken, groupChatId2,
          `⚠️ ${preAssignedDealerName} vừa check-out (đang pre_assigned cho bàn ${preAssignedTableName ?? "N/A"}).`
        ).catch(() => {});
      }
    }
  }

  // 5. Audit log
  await admin.from("audit_logs").insert({
    club_id: clubId,
    actor_id: uid,
    action: "checkout_dealer",
    entity_type: "dealer_attendance",
    entity_id: attendanceId,
    payload: {
      dealer_name: dealerName,
      was_pre_assigned: wasPreAssigned,
      released_pre_assigned: releasedPreAssigned,
      pre_assigned_table: preAssignedTableName,
    },
  }).then(() => {}).catch(() => {});

  return {
    attendance_id: attendanceId,
    success: true,
    dealer_name: dealerName,
    check_in_time: checkInTime,
    check_out_time: nowISO,
    total_hours: totalHours,
    released_pre_assigned: releasedPreAssigned,
    pre_assigned_table: preAssignedTableName,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);
    const payload = decodeJWT(auth.slice(7));
    if (!payload) return jsonResponse({ error: "Invalid token" }, 401);
    const uid = payload.sub;

    const body = await req.json();
    const ids: string[] = body.attendance_ids || (body.attendance_id ? [body.attendance_id] : []);
    if (!ids.length) return jsonResponse({ error: "attendance_id or attendance_ids required" }, 400);

    // Verify dealer_control permission (check first item for club_id, then assume same club for batch)
    const { data: firstAtt } = await admin
      .from("dealer_attendance")
      .select("dealers!inner(club_id)")
      .eq("id", ids[0])
      .maybeSingle();
    if (!firstAtt) return jsonResponse({ error: "First attendance not found" }, 404);

    const clubId = (firstAtt as any).dealers?.club_id;
    if (!clubId) return jsonResponse({ error: "Cannot determine club" }, 400);

    const { data: isControl } = await admin
      .rpc("is_club_dealer_control", { _user_id: uid, _club_id: clubId });
    if (!isControl) return jsonResponse({ error: "Forbidden" }, 403);

    // Process all attendance IDs
    const results = await Promise.allSettled(
      ids.map((id: string) => processOneCheckout(admin, botToken, uid, id))
    );

    const mappedResults = results.map((r) =>
      r.status === "fulfilled" ? r.value : { attendance_id: "unknown", success: false, error: r.reason?.message ?? "Unknown error" }
    );

    return jsonResponse({ results: mappedResults });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});