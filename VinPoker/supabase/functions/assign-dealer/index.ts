import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  pickTopDealers,
  buildScoreLabel,
  computeSwingDuration,
  corsHeaders,
  jsonResponse,
  type ScoreBreakdown,
} from "../_shared/dealer-utils.ts";
import {
  notifyIncomingDealer,
  getClubTelegramChatId,
  sendTelegramNotification,
  mention,
} from "../_shared/telegram.ts";
import { OPEN_TABLE_GRACE_MINUTES } from "../_shared/openTableGrace.ts";

function decodeJWT(token: string): { sub: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const payload = decodeJWT(authHeader.slice(7));
    if (!payload) return json({ error: "Invalid token" }, 401);
    const uid = payload.sub;

    const body = await req.json().catch(() => ({}));
    const { table_id, force_dealer_id, requested_by, idempotency_key, return_suggestions_only, shift_id } = body ?? {};
    if (!table_id) return json({ error: "table_id required" }, 400);

    console.log(`[assign-dealer] table=${table_id} force=${force_dealer_id} shift=${shift_id} idemp=${idempotency_key}`);

    if (idempotency_key) {
      // Format validation only — atomic idempotency check is in RPC Step 0
      if (typeof idempotency_key !== "string" || idempotency_key.length > 255) {
        return json({ error: "Invalid idempotency_key" }, 400);
      }
    }

    const { data: table, error: te } = await admin
      .from("game_tables")
      .select("id, club_id, table_name, table_type, status, shift_id")
      .eq("id", table_id)
      .maybeSingle();
    if (te || !table) return json({ error: "Table not found" }, 404);

    // Block assignment if table already has an active dealer (unless force or suggestions-only)
    const { data: activeAssignment } = await admin
      .from("dealer_assignments")
      .select("id, status")
      .eq("table_id", table_id)
      .in("status", ["assigned", "on_break"])
      .is("released_at", null)
      .maybeSingle();
    if (activeAssignment && !force_dealer_id && !return_suggestions_only) {
      return json({ error: "Table already has an active dealer", assignment_id: activeAssignment.id }, 409);
    }

    const { data: isControl } = await admin.rpc("is_club_dealer_control", { _user_id: uid, _club_id: table.club_id });
    if (!isControl) return json({ error: "Forbidden — not a dealer controller" }, 403);

    const { data: config } = await admin
      .from("swing_config")
      .select("*")
      .eq("club_id", table.club_id)
      .eq("table_type", table.table_type)
      .maybeSingle();

    const breakDuration = config?.break_duration_minutes ?? 20;
    const tourTier = table.table_type === "TOURNAMENT" ? "HIGH" : undefined;
    const { data: localDate } = await admin.rpc("club_local_date", { p_club_id: table.club_id });
    const today = localDate ?? new Date().toISOString().split("T")[0];

    const durResult = await computeSwingDuration(admin, table.club_id, {
      swing_duration_minutes: config?.swing_duration_minutes ?? 45,
      auto_adjust_duration: config?.auto_adjust_duration ?? false,
      min_duration: Math.max(30, config?.min_duration_minutes ?? 30),
    });
    const swingDuration = durResult.durationMinutes;
    console.log(`[assign-dealer] Swing duration for club ${table.club_id}:`, durResult.durationRationale);

    if (force_dealer_id) {
      const query = admin
        .from("dealer_attendance")
        .select("id, shift_id, dealers!inner(full_name, telegram_username, telegram_user_id)")
        .eq("dealer_id", force_dealer_id)
        .eq("status", "checked_in");

      const { data: attendanceRows, error: ae } = await query
        .order("check_in_time", { ascending: false })
        .limit(1);

      if (ae) return json({ error: `ATTENDANCE_QUERY_FAILED: ${ae.message}` }, 500);
      if (!attendanceRows?.length) {
        const countAll = await admin
          .from("dealer_attendance")
          .select("id", { count: "exact", head: true })
          .eq("dealer_id", force_dealer_id)
          .eq("status", "checked_in");
        console.log(`[assign-dealer] dealer ${force_dealer_id} not found (total today: ${countAll.count})`);
        return json({ error: "DEALER_NOT_CHECKED_IN: Dealer hasn't checked in today", dealer_id: force_dealer_id, shift_id }, 400);
      }

      const attendance = attendanceRows[0];

      const { data: lockAcquired } = await admin.rpc("select_dealer_for_update", {
        p_attendance_id: attendance.id,
      });
      if (!lockAcquired) {
        return json({
          error: "DEALER_BUSY: Dealer này vừa được phân công bởi người dùng khác. Vui lòng thử lại.",
          dealer_id: force_dealer_id,
        }, 409);
      }

      // ═══════════════════════════════════════════════════════════════════
      // SINGLE SOURCE OF TRUTH: Call assign_dealer_to_table RPC
      // All release + insert logic lives in the RPC (atomic transaction).
      // Edge fn = auth/validation wrapper only.
      // ═══════════════════════════════════════════════════════════════════

      // Open-table grace: the incoming dealer gets OPEN_TABLE_GRACE_MINUTES of
      // warmup before the swing clock starts — swing_due_at = now + grace + duration
      // so the table is not counted overdue during setup. assigned_at = now (the
      // frontend shows "Vào swing sau M:SS" for the grace window keyed off it).
      const assignedNow = Date.now();
      const swingDueAt = new Date(assignedNow + (OPEN_TABLE_GRACE_MINUTES + swingDuration) * 60 * 1000).toISOString();
      const { data: rpcResult, error: rpcErr } = await admin.rpc(
        "assign_dealer_to_table",
        {
          p_attendance_id: attendance.id,
          p_table_id: table_id,
          p_assigned_at: new Date(assignedNow).toISOString(),
          p_swing_due_at: swingDueAt,
          p_club_id: table.club_id,
          p_idempotency_key: idempotency_key ?? null,
          p_force_replace: true,
        }
      );

      if (rpcErr) {
        console.error("[assign-dealer] RPC error:", rpcErr.message);
        return json({ error: rpcErr.message }, 500);
      }

      const outcome = typeof rpcResult === "string" ? rpcResult : rpcResult?.outcome;

      if (outcome === "conflict") {
        return json({
          error: "DEALER_BUSY: Dealer này vừa được phân công bởi người dùng khác. Vui lòng thử lại.",
          dealer_id: force_dealer_id,
        }, 409);
      }

      if (outcome === "table_occupied") {
        return json({ error: "Table already has an active dealer" }, 409);
      }

      if (outcome !== "ok") {
        return json({ error: `Unexpected outcome: ${outcome}` }, 500);
      }

      const assignmentId = typeof rpcResult === "object" ? rpcResult.assignment_id : null;

      if (!assignmentId) {
        console.error("[assign-dealer] RPC returned ok but no assignment_id");
        return json({ error: "Assignment created but ID missing" }, 500);
      }

      // Handle idempotent replay — assignment already existed
      const isIdempotent = typeof rpcResult === "object" && rpcResult.idempotent === true;

      await admin.from("audit_logs").insert({
        club_id: table.club_id,
        actor_id: requested_by ?? uid,
        action: "assign",
        entity_type: "dealer_assignment",
        entity_id: assignmentId,
        payload: {
          table_id,
          attendance_id: attendance.id,
          mode: "force",
          outcome: "ok",
          idempotent: isIdempotent || undefined,
          orphan_count: typeof rpcResult === "object" ? (rpcResult.orphan_count ?? 0) : 0,
        },
      });

      // Telegram notification.
      // wasEmpty = the table had no active dealer before this assignment, i.e.
      // we are OPENING it (vs swinging/replacing a dealer on an occupied table).
      const wasEmpty = !activeAssignment;
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
      if (botToken) {
        const dealerInfo = (attendance as any)?.dealers ?? {};
        const dealerName: string = dealerInfo.full_name ?? "Unknown";
        const dealerUsername: string | null = dealerInfo.telegram_username ?? null;
        const dealerUserId: number | null = dealerInfo.telegram_user_id ? Number(dealerInfo.telegram_user_id) : null;

        // Tour name for the message (table's dealer_shifts.tour_name) so Telegram
        // shows which tour the table belongs to.
        let tourName: string | null = null;
        if ((table as any).shift_id) {
          const { data: shiftRow } = await admin
            .from("dealer_shifts")
            .select("tour_name")
            .eq("id", (table as any).shift_id)
            .maybeSingle();
          tourName = (shiftRow as any)?.tour_name ?? null;
        }
        const tourInfo = tourName ? ` (${tourName})` : "";
        const dealerMention = mention({ full_name: dealerName, telegram_username: dealerUsername });

        // Distinct message when this assignment OPENS a previously-empty table.
        const groupMsg = wasEmpty
          ? `🆕 Mở bàn: ${dealerMention} - ${table.table_name}${tourInfo}`
          : `🪑 Vào bàn ${table.table_name}${tourInfo}: ${dealerMention}`;

        const chatId = await getClubTelegramChatId(admin, table.club_id);
        // Run the sends as a background task that the runtime keeps alive past
        // the response (EdgeRuntime.waitUntil) so they reliably deliver. The
        // previous fire-and-forget sends were dropped when the function froze on
        // return, so manual opens often sent nothing. Fallback: await locally.
        const sends = Promise.allSettled([
          notifyIncomingDealer(
            botToken,
            { full_name: dealerName, telegram_username: dealerUsername, telegram_user_id: dealerUserId },
            table.table_name,
            swingDuration,
          ),
          chatId ? sendTelegramNotification(botToken, chatId, groupMsg) : Promise.resolve(),
        ]);
        const er = (globalThis as any).EdgeRuntime;
        if (er?.waitUntil) er.waitUntil(sends);
        else await sends;
      }

      return json({ assignment: { id: assignmentId, status: "success" }, status: "success" });
    }

    const topDealers = await pickTopDealers(admin, table.club_id, 3, {
      tourTier,
      currentTableId: table_id,
      includeScoreBreakdown: true,
    });

    const formatted = topDealers.map((d) => ({
      attendance_id: d.id,
      dealer_id: d.dealer_id,
      dealer_name: d.full_name,
      tier: d.tier,
      score: d.score ?? 0,
      score_breakdown: d.score_breakdown ?? {} as ScoreBreakdown,
      worked_minutes: d.worked_minutes_since_last_break,
      reason: d.score_breakdown
        ? buildScoreLabel(d.tier, d.score_breakdown)
        : "Sẵn sàng",
    }));

    if (return_suggestions_only) {
      return json({ suggestions: formatted });
    }

    if (!formatted.length) {
      return json({ error: "NO_DEALERS_AVAILABLE: No dealers checked in and available" });
    }

    return json({ suggestions: formatted });
  } catch (e) {
    return json({ error: `INTERNAL_ERROR: ${(e as Error).message}` }, 500);
  }
});
