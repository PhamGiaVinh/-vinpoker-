import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SMITH_GATE_WINDOW_MIN = 2;
const DEALER_FETCH_TIMEOUT_MS = 5000;
const CIRCUIT_BREAKER_THRESHOLD = 10;
const PER_CLUB_LOCK_TIMEOUT_MS = 30000;

interface BackupResult {
  outcome: "processed" | "skipped_lock" | "skipped_smart_gate" | "skipped_no_dealers" | "error";
  clubs_processed: number;
  dealers_processed: number;
  duration_ms: number;
  errors: string[];
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startTime = Date.now();
  const errors: string[] = [];
  let clubsProcessed = 0;
  let dealersProcessed = 0;
  let outcome: BackupResult["outcome"] = "processed";

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
    const clubId = (await req.json().catch(() => ({})))?.club_id ?? null;

    // ═══ Step 1: Smart gate — skip if no available dealers ═══
    // NOTE: dealer_attendance has NO updated_at column.
    // Use existence check (any available dealer = proceed). Per-dealer
    // atomic check is the real filter for whether work is needed.
    const { count: recentCount, error: gateErr } = await admin
      .from("dealer_attendance")
      .select("id", { count: "exact", head: true })
      .eq("current_state", "available");

    if (gateErr) {
      console.warn("[run-dealer-ready-backup] smart gate query failed:", gateErr.message);
    } else if (!recentCount || recentCount === 0) {
      console.log("[run-dealer-ready-backup] smart gate: no available dealers, skipping");
      outcome = "skipped_smart_gate";
      await logMetric(admin, "run-dealer-ready-backup", null, startTime, "success", 0, 0, "smart_gate_skip");
      return json({ outcome, duration_ms: Date.now() - startTime });
    }

    // ═══ Step 2: Determine clubs to process ═══
    let clubIds: string[] = [];
    if (clubId) {
      clubIds = [clubId];
    } else {
      const { data: clubs, error: clubErr } = await admin
        .from("clubs")
        .select("id")
        .eq("status", "approved");
      if (clubErr) {
        errors.push(`clubs query: ${clubErr.message}`);
        outcome = "error";
        await logMetric(admin, "run-dealer-ready-backup", null, startTime, "failure", 1, 0, errors.join("; "));
        return json({ outcome, errors, duration_ms: Date.now() - startTime }, 500);
      }
      clubIds = (clubs ?? []).map((c) => c.id);
    }

    if (clubIds.length === 0) {
      outcome = "skipped_no_dealers";
      await logMetric(admin, "run-dealer-ready-backup", null, startTime, "success", 0, 0, "no_clubs");
      return json({ outcome, duration_ms: Date.now() - startTime });
    }

    // ═══ Step 3: Process each club with circuit breaker + advisory lock ═══
    let consecutiveFailures = 0;

    for (const cid of clubIds) {
      if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        console.warn(`[run-dealer-ready-backup] circuit breaker: ${consecutiveFailures} consecutive failures, stopping`);
        errors.push(`circuit_breaker_at_${consecutiveFailures}`);
        break;
      }

      // Try to acquire advisory lock for this club
      const lockAcquired = await tryAcquireLock(admin, cid);
      if (!lockAcquired) {
        console.log(`[run-dealer-ready-backup] lock held for club ${cid}, skipping`);
        continue;
      }

      try {
        const { data: readyDealers, error: readyErr } = await admin
          .from("dealer_attendance")
          .select("id, dealer_id")
          .eq("current_state", "available")
          .limit(20);

        if (readyErr) {
          errors.push(`club ${cid}: ${readyErr.message}`);
          consecutiveFailures++;
          continue;
        }

        if (!readyDealers || readyDealers.length === 0) {
          consecutiveFailures = 0;
          continue;
        }

        for (const dealer of readyDealers) {
          try {
            const { data: verifyResult, error: verifyErr } = await Promise.race([
              admin.rpc("atomic_dealer_ready_check", {
                p_club_id: cid,
                p_attendance_id: dealer.id,
              }),
              new Promise<{ data: null; error: Error }>((_, reject) =>
                setTimeout(
                  () => reject(new Error("timeout")),
                  DEALER_FETCH_TIMEOUT_MS
                )
              ),
            ]).catch((err) => ({ data: null, error: err as Error }));

            if (verifyErr) {
              errors.push(`verify ${dealer.id}: ${verifyErr.message}`);
              consecutiveFailures++;
              continue;
            }

            if (!verifyResult || verifyResult.skipped) {
              continue;
            }

            const restDeficit = Math.max(0, (verifyResult.rest_threshold_min ?? 15) - (verifyResult.rest_min ?? 0));

            const { data: overdueTable, error: overdueErr } = await admin
              .from("dealer_assignments")
              .select(`
                id,
                version,
                table_id,
                swing_due_at
              `)
              .eq("club_id", cid)
              .eq("status", "assigned")
              .lt("swing_due_at", new Date().toISOString())
              .order("swing_due_at", { ascending: true })
              .limit(1)
              .maybeSingle();

            if (overdueErr || !overdueTable) {
              continue;
            }

            const { data: swingResult, error: swingErr } = await admin.rpc("perform_swing", {
              p_assignment_id: overdueTable.id,
              p_version: overdueTable.version,
              p_next_attendance_id: dealer.id,
              p_send_to_break: false,
              p_break_duration_minutes: 15,
              p_swing_duration_minutes: 30,
              p_swing_due_at: null,
              p_rest_deficit_minutes: restDeficit,
            });

            if (swingErr) {
              errors.push(`swing ${dealer.id}: ${swingErr.message}`);
              consecutiveFailures++;
              continue;
            }

            if (swingResult?.outcome === "swung") {
              dealersProcessed++;
              console.log(`[run-dealer-ready-backup] ✅ club=${cid} table=${overdueTable.table_id} dealer=${dealer.id} rest_deficit=${restDeficit}min`);
            }

            consecutiveFailures = 0;
          } catch (dealerErr) {
            const msg = dealerErr instanceof Error ? dealerErr.message : String(dealerErr);
            errors.push(`dealer ${dealer.id}: ${msg}`);
            consecutiveFailures++;
          }
        }

        clubsProcessed++;
      } finally {
        await releaseLock(admin, cid);
      }
    }

    await logMetric(
      admin,
      "run-dealer-ready-backup",
      null,
      startTime,
      errors.length === 0 ? "success" : errors.length < clubsProcessed ? "partial" : "failure",
      errors.length,
      dealersProcessed,
      errors.length > 0 ? errors.slice(0, 3).join("; ") : undefined
    );

    return json({
      outcome,
      clubs_processed: clubsProcessed,
      dealers_processed: dealersProcessed,
      duration_ms: Date.now() - startTime,
      errors: errors.slice(0, 5),
    } as BackupResult);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[run-dealer-ready-backup] unhandled error:", errorMsg);
    try {
      const url = Deno.env.get("SUPABASE_URL")!;
      const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(url, service);
      await logMetric(admin, "run-dealer-ready-backup", null, startTime, "failure", 1, 0, errorMsg);
    } catch (_) {
      // best-effort
    }
    return json({ outcome: "error", error: errorMsg, duration_ms: Date.now() - startTime }, 500);
  }
});

async function tryAcquireLock(admin: ReturnType<typeof createClient>, clubId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("try_acquire_cron_lock", {
      p_lock_name: `dealer_ready_backup_${clubId}`,
    });
    if (error) {
      console.warn(`[run-dealer-ready-backup] lock RPC error for ${clubId}:`, error.message);
      return true; // best-effort: if RPC doesn't exist, allow execution
    }
    return data === true;
  } catch (err) {
    console.warn(`[run-dealer-ready-backup] lock exception for ${clubId}:`, err);
    return true;
  }
}

async function releaseLock(admin: ReturnType<typeof createClient>, clubId: string): Promise<void> {
  try {
    await admin.rpc("release_cron_lock", {
      p_lock_name: `dealer_ready_backup_${clubId}`,
    });
  } catch (err) {
    console.warn(`[run-dealer-ready-backup] release lock exception for ${clubId}:`, err);
  }
}

async function logMetric(
  admin: ReturnType<typeof createClient>,
  cronName: string,
  clubId: string | null,
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
