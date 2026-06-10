import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface NotifyPayload {
  club_id: string;
  attendance_id: string;
  dealer_id: string;
  current_state: string;
  xmin: string;
  fired_at: string;
}

interface PickResult {
  outcome: "swung" | "no_table" | "skipped" | "race_lost" | "error";
  table_id?: string;
  assignment_id?: string;
  new_assignment_id?: string;
  rest_deficit_minutes?: number;
  reason?: string;
  error?: string;
  duration_ms?: number;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startTime = Date.now();
  let clubId: string | null = null;
  let processedCount = 0;
  let errorCount = 0;

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!url || !service) {
      return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    const admin = createClient(url, service);
    const body = (await req.json().catch(() => ({}))) as NotifyPayload;
    clubId = body.club_id;

    if (!body.attendance_id || !body.club_id) {
      return json({ error: "Missing attendance_id or club_id" }, 400);
    }

    // ═══ Step 1: Atomic verify (BUG #1 fix layer 2) ═══
    const { data: verifyResult, error: verifyErr } = await admin.rpc(
      "atomic_dealer_ready_check",
      {
        p_club_id: body.club_id,
        p_attendance_id: body.attendance_id,
      }
    );

    if (verifyErr) {
      console.error("[process-swing-on-dealer-ready] atomic check error:", verifyErr.message);
      await logMetric(admin, "process-swing-on-dealer-ready", body.club_id, startTime, "failure", 1, 0, verifyErr.message);
      return json({ error: "verify_failed", details: verifyErr.message }, 500);
    }

    if (verifyResult?.skipped) {
      console.log(`[process-swing-on-dealer-ready] skipped: ${verifyResult.skipped}`, {
        attendance_id: body.attendance_id,
      });
      await logMetric(admin, "process-swing-on-dealer-ready", body.club_id, startTime, "success", 0, 0, `skipped:${verifyResult.skipped}`);
      return json({ skipped: verifyResult.skipped, ...verifyResult });
    }

    // Verified! Dealer is available
    const verifiedAttendanceId = verifyResult.attendance_id;
    const restMin = verifyResult.rest_min;
    const restThreshold = verifyResult.rest_threshold_min;
    const restDeficit = Math.max(0, restThreshold - restMin);

    console.log(`[process-swing-on-dealer-ready] verified attendance=${verifiedAttendanceId} rest=${restMin}min threshold=${restThreshold}min deficit=${restDeficit}min`);

    // ═══ Step 2: Find most overdue table in this club ═══
    const { data: overdueTable, error: overdueErr } = await admin
      .from("dealer_assignments")
      .select(`
        id,
        version,
        table_id,
        attendance_id,
        swing_due_at,
        club_id,
        game_tables!inner (
          id,
          table_name,
          status
        )
      `)
      .eq("club_id", body.club_id)
      .eq("status", "assigned")
      .lt("swing_due_at", new Date().toISOString())
      .order("swing_due_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (overdueErr) {
      console.error("[process-swing-on-dealer-ready] query error:", overdueErr.message);
      await logMetric(admin, "process-swing-on-dealer-ready", body.club_id, startTime, "failure", 1, 0, overdueErr.message);
      return json({ error: "query_failed", details: overdueErr.message }, 500);
    }

    if (!overdueTable) {
      console.log(`[process-swing-on-dealer-ready] no overdue table for club ${body.club_id}`);
      await logMetric(admin, "process-swing-on-dealer-ready", body.club_id, startTime, "success", 0, 0, "no_overdue_table");
      return json({ skipped: "no_overdue_table", verified: true });
    }

    // ═══ Step 3: Call perform_swing with rest_deficit (BUG #5 fix) ═══
    const { data: swingResult, error: swingErr } = await admin.rpc("perform_swing", {
      p_assignment_id: overdueTable.id,
      p_version: overdueTable.version,
      p_next_attendance_id: verifiedAttendanceId,
      p_send_to_break: false,
      p_break_duration_minutes: 15,
      p_swing_duration_minutes: 30,
      p_swing_due_at: null,
      p_rest_deficit_minutes: restDeficit,
    });

    if (swingErr) {
      console.error("[process-swing-on-dealer-ready] perform_swing error:", swingErr.message);
      await logMetric(admin, "process-swing-on-dealer-ready", body.club_id, startTime, "failure", 1, 0, swingErr.message);
      return json({ error: "swing_failed", details: swingErr.message }, 500);
    }

    const result: PickResult = {
      outcome: swingResult?.outcome ?? "unknown",
      table_id: overdueTable.table_id,
      assignment_id: overdueTable.id,
      new_assignment_id: swingResult?.new_assignment_id,
      rest_deficit_minutes: restDeficit,
      duration_ms: Date.now() - startTime,
    };

    if (swingResult?.outcome === "swung") {
      processedCount = 1;
      console.log(`[process-swing-on-dealer-ready] ✅ SWUNG table=${overdueTable.table_id} new_assignment=${swingResult.new_assignment_id}`);
    } else {
      console.log(`[process-swing-on-dealer-ready] outcome=${swingResult?.outcome}`, { swingResult });
    }

    await logMetric(
      admin,
      "process-swing-on-dealer-ready",
      body.club_id,
      startTime,
      "success",
      0,
      processedCount,
      JSON.stringify({ outcome: result.outcome, rest_deficit: restDeficit })
    );

    return json(result);
  } catch (err) {
    errorCount = 1;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[process-swing-on-dealer-ready] unhandled error:", errorMsg);
    if (clubId) {
      try {
        const url = Deno.env.get("SUPABASE_URL")!;
        const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const admin = createClient(url, service);
        await logMetric(admin, "process-swing-on-dealer-ready", clubId, startTime, "failure", 1, 0, errorMsg);
      } catch (_) {
        // best-effort logging
      }
    }
    return json({ error: "unhandled", details: errorMsg }, 500);
  }
});

async function logMetric(
  admin: any,
  cronName: string,
  clubId: string,
  startTime: number,
  status: "success" | "failure" | "partial",
  errorCount: number,
  processedCount: number,
  errorMessage?: string
): Promise<void> {
  const duration = Date.now() - startTime;
  try {
    await admin.from("cron_metrics").insert({
      cron_name: cronName,
      club_id: clubId,
      duration_ms: duration,
      status,
      error_count: errorCount,
      processed_count: processedCount,
      error_message: errorMessage ? errorMessage.substring(0, 500) : null,
    });
  } catch (err) {
    console.warn(`[${cronName}] Failed to log metric:`, err);
  }
}
