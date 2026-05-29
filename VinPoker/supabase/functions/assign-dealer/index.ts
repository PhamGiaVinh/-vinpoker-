import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  pickTopDealers,
  buildScoreLabel,
  computeSwingDuration,
  corsHeaders,
  jsonResponse,
  type ScoreBreakdown,
} from "../_shared/dealer-utils.ts";

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
      const { data: existing } = await admin
        .from("dealer_assignments")
        .select("id, status")
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();
      if (existing) return json({ status: "already_processed", id: existing.id });
    }

    const { data: table, error: te } = await admin
      .from("game_tables")
      .select("id, club_id, table_name, table_type, status")
      .eq("id", table_id)
      .maybeSingle();
    if (te || !table) return json({ error: "Table not found" }, 404);
    if (table.status !== "active") return json({ error: "Table is not active" }, 400);

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
        .select("id, shift_id")
        .eq("dealer_id", force_dealer_id)
        .eq("shift_date", today)
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
          .eq("shift_date", today)
          .in("status", ["checked_in"]);
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

      const swingDueAt = new Date(Date.now() + swingDuration * 60 * 1000).toISOString();
      const { data: assignment, error: ase } = await admin
        .from("dealer_assignments")
        .insert({
          attendance_id: attendance.id,
          table_id,
          assigned_at: new Date().toISOString(),
          status: "assigned",
          swing_due_at: swingDueAt,
          idempotency_key: idempotency_key ?? null,
        })
        .select("id, assigned_at, status")
        .single();
      if (ase) return json({ error: ase.message }, 500);

      await admin.from("audit_logs").insert({
        club_id: table.club_id,
        actor_id: requested_by ?? uid,
        action: "assign",
        entity_type: "dealer_assignment",
        entity_id: assignment.id,
        payload: { table_id, attendance_id: attendance.id, mode: "force" },
      });

      return json({ assignment, status: "success" });
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
