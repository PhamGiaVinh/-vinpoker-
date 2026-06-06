import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { formatCloseTableMessage, sendTelegramNotification, getClubTelegramChatId } from "../_shared/telegram.ts";

function decodeJWT(token: string): { sub: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const admin = createClient(url, service);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const payload = decodeJWT(authHeader.slice(7));
    if (!payload) return json({ error: "Invalid token" }, 401);
    const uid = payload.sub;

    const body = await req.json().catch(() => ({}));
    const { table_id, requested_by } = body ?? {};
    if (!table_id) return json({ error: "table_id required" }, 400);

    // Get table with club info
    const { data: table, error: te } = await admin
      .from("game_tables")
      .select("id, club_id, table_name, table_type, status, tour_tier")
      .eq("id", table_id)
      .maybeSingle();
    if (te || !table) return json({ error: "Table not found" }, 404);
    // Idempotent: if the table is already inactive (e.g. process-swing cron
    // just closed it, or a duplicate click raced), return success without
    // any side effects. This avoids spurious 400s on the cashier map.
    if (table.status !== "active") {
      return json({ success: true, already_inactive: true, had_dealer: false }, 200);
    }

    // Verify caller has dealer_control for this club
    const { data: isControl } = await admin.rpc("is_club_dealer_control", { _user_id: uid, _club_id: table.club_id });
    if (!isControl) return json({ error: "Forbidden — not a dealer controller" }, 403);

    // Release any pre_assigned dealer for this table (before closing)
    const { data: preAssigned } = await admin
      .from("dealer_attendance")
      .select("id")
      .eq("pre_assigned_table_id", table_id)
      .eq("current_state", "pre_assigned");

    for (const pa of preAssigned ?? []) {
      await admin.rpc("transition_dealer_state", {
        p_attendance_id: pa.id,
        p_new_state: "available",
        p_reason: "table_closed_release_pre_assign",
      });
    }

    await admin
      .from("dealer_attendance")
      .update({ pre_assigned_table_id: null, pre_assigned_at: null })
      .eq("pre_assigned_table_id", table_id);

    let dealerBreakId: string | null = null;
    let hadDealer = false;
    let lastDealerInfo: { full_name: string; telegram_username?: string | null; workedMinutes: number } | null = null;

    // Find active assignment on this table (assigned or on_break)
    const { data: assignment } = await admin
      .from("dealer_assignments")
      .select("id, attendance_id, status, assigned_at")
      .eq("table_id", table_id)
      .in("status", ["assigned", "on_break"])
      .maybeSingle();

    if (assignment) {
      hadDealer = true;

      // Get dealer info for notification
      const { data: att } = await admin
        .from("dealer_attendance")
        .select("dealer_id, dealers!inner(full_name, telegram_username)")
        .eq("id", assignment.attendance_id)
        .maybeSingle();
      if (att) {
        const d = (att as any).dealers;
        lastDealerInfo = {
          full_name: d.full_name,
          telegram_username: d.telegram_username,
          workedMinutes: Math.round((Date.now() - new Date(assignment.assigned_at).getTime()) / 60000),
        };
      }

      // Release the dealer (no status check — close-table is authoritative)
      const { error: relErr } = await admin
        .from("dealer_assignments")
        .update({ released_at: new Date().toISOString(), status: "completed" })
        .eq("id", assignment.id);
      if (relErr) return json({ error: `Failed to release dealer: ${relErr.message}` }, 500);

      const { data: activeBreak } = await admin
        .from("dealer_breaks")
        .select("id")
        .eq("assignment_id", assignment.id)
        .is("break_end", null)
        .maybeSingle();

      if (activeBreak) {
        const { error: endBreakErr } = await admin.rpc("end_dealer_break", {
          p_break_id: activeBreak.id,
          p_attendance_id: assignment.attendance_id,
        });
        if (endBreakErr) {
          console.error(`[close-table] Failed to end active break ${activeBreak.id}: ${endBreakErr.message}`);
        }
      }

      const { data: releaseResult } = await admin.rpc("transition_dealer_state", {
        p_attendance_id: assignment.attendance_id,
        p_new_state: "available",
        p_reason: `close_table_${table_id}`,
      });
      if (releaseResult?.ok === false) {
        console.error(`[close-table] Failed to release dealer state: ${releaseResult.error}`);
      }
    }

    // Before deactivating, remove any conflicting row with same name + shift_id IS NULL
    const { data: conflict } = await admin
      .from("game_tables")
      .select("id")
      .eq("club_id", table.club_id)
      .eq("table_name", table.table_name)
      .is("shift_id", null)
      .neq("id", table_id)
      .maybeSingle();
    if (conflict) {
      await admin.from("game_tables").delete().eq("id", conflict.id);
    }

    // Deactivate the table and return it to pool (shift_id = null)
    const { error: deactErr } = await admin
      .from("game_tables")
      .update({ status: "inactive", shift_id: null })
      .eq("id", table_id);
    if (deactErr) return json({ error: `Failed to deactivate table: ${deactErr.message}` }, 500);

    // Audit log
    await admin.from("swing_audit_logs").insert({
      club_id: table.club_id,
      table_id,
      action: "table_closed",
      details: {
        table_name: table.table_name,
        had_dealer: hadDealer,
        dealer_break_id: dealerBreakId,
      },
      triggered_by: requested_by ?? uid,
    });

    await admin.from("audit_logs").insert({
      club_id: table.club_id,
      actor_id: requested_by ?? uid,
      action: "table_closed",
      entity_type: "game_table",
      entity_id: table_id,
      payload: { table_name: table.table_name, had_dealer: hadDealer, dealer_break_id: dealerBreakId },
    });

    // Send Telegram notification via shared module
    try {
      const chatId = await getClubTelegramChatId(admin, table.club_id);
      if (botToken && chatId) {
        const msg = formatCloseTableMessage({
          tableName: table.table_name,
          dealerName: lastDealerInfo?.full_name ?? "N/A",
          tourName: table.tour_tier ?? undefined,
        });
        sendTelegramNotification(botToken, chatId, msg).catch(() => {});
      }
    } catch { /* non-critical */ }

    return json({
      success: true,
      dealer_break_id: dealerBreakId,
      had_dealer: hadDealer,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
