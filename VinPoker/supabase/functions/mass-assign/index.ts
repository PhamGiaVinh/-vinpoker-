import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, jsonResponse, fillEmptyTables, computeSwingDuration } from "../_shared/dealer-utils.ts";
import { formatMassAssignMessage, sendTelegramNotification, getClubTelegramChatId } from "../_shared/telegram.ts";

function decodeJWT(token: string): { sub: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
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

    const body = await req.json().catch(() => ({}));
    const { club_id, shift_id } = body ?? {};
    if (!club_id) return jsonResponse({ error: "club_id required" }, 400);

    const { data: isControl } = await admin.rpc("is_club_dealer_control", { _user_id: uid, _club_id: club_id });
    if (!isControl) return jsonResponse({ error: "Forbidden" }, 403);

    // ── Compute swing duration (batch-consistent) ──────────────────────────
    const { data: swingConfig } = await admin
      .from("swing_config")
      .select("*")
      .eq("club_id", club_id)
      .eq("table_type", "tournament")
      .maybeSingle();

    const durResult = await computeSwingDuration(admin, club_id, {
      swing_duration_minutes: swingConfig?.swing_duration_minutes ?? 45,
      auto_adjust_duration: swingConfig?.auto_adjust_duration ?? false,
      min_duration: Math.max(30, swingConfig?.min_duration_minutes ?? 30),
    });

    const swingDueAt = new Date(Date.now() + durResult.durationMinutes * 60 * 1000).toISOString();

    console.log(
      `[mass-assign] Swing duration: ${durResult.durationMinutes}min ` +
      `(${durResult.durationRationale}), dueAt=${swingDueAt}`
    );

    // Use shared fillEmptyTables with pre-calculated swing_due_at for batch consistency
    const { assignments } = await fillEmptyTables(
      admin, club_id, shift_id ?? null, botToken,
      undefined, swingDueAt
    );

    // Audit logs
    for (const a of assignments) {
      try { await admin.from("audit_logs").insert({
        club_id,
        actor_id: uid,
        action: "mass_assign",
        entity_type: "dealer_assignment",
        payload: { table_name: a.table_name, dealer_name: a.full_name, mode: "mass_assign", tier: "tournament" },
      }); } catch {}
    }

    // Telegram
    const assignedEntries = assignments.map(a => ({
      tableName: a.table_name,
      dealer: { full_name: a.full_name },
    }));

    try {
      const chatId = await getClubTelegramChatId(admin, club_id);
      if (botToken && chatId && assignedEntries.length > 0) {
        // Group notification: summary of all assignments
        const msg = formatMassAssignMessage(assignedEntries);
        sendTelegramNotification(botToken, chatId, msg, {
          logError: (errMsg) => {
            admin.from("swing_audit_logs").insert({
              club_id, action: "mass_assign_telegram_failed",
              error_message: errMsg, triggered_by: uid,
            }).then(() => {}).catch(() => {});
          },
        }).catch(() => {});

        // Individual dealer notifications: each dealer gets a personal message
        for (const a of assignments) {
          if (a.telegram_username) {
            const dealerMsg = `🎲 Bạn được gán vào *${a.table_name}*. Xoay vòng sau ${durResult.durationMinutes} phút.`;
            sendTelegramNotification(botToken, chatId, dealerMsg).catch(() => {});
          }
        }
      }
    } catch { /* non-critical */ }

    return jsonResponse({
      success: true,
      assigned: assignments.length,
      swingConfig: {
        durationMinutes: durResult.durationMinutes,
        isDynamic: durResult.isDynamic,
        rationale: durResult.durationRationale,
      },
      assignments: assignments.map(a => ({
        table_name: a.table_name,
        dealer_name: a.full_name,
        tier: "tournament",
      })),
    });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
