/**
 * process-pre-announce-jobs
 *
 * Phase 5 PR #2: BUG #2 (no duplicate pre-announce) + Gap #1 (DB queue) + Gap #3 (timeout/retry).
 *
 * Processes pre_announce_jobs table: sends pending jobs to Telegram with:
 *   - 5s per-attempt timeout (AbortController)
 *   - 3 HTTP-level retries with exponential backoff (200ms, 400ms)
 *   - DB-level max_attempts (job stays 'pending' for next tick on transient failure)
 *   - Circuit breaker: skip tick if >10 jobs failed in last 5 min
 *   - Idempotency via uq_pre_announce_active partial unique index
 *   - Tick timeout: 25s hard cap to prevent overlap with 30s cron
 *
 * Cron schedule: every 30s via pg_cron.
 * Auth: Bearer token in Authorization header.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_JOBS_PER_TICK = 20;
const PER_JOB_TIMEOUT_MS = 5000;
const TICK_TIMEOUT_MS = 25000;
const CIRCUIT_BREAKER_FAILURES = 10;
const CIRCUIT_BREAKER_WINDOW_MIN = 5;
const MAX_HTTP_RETRIES = 3;

interface ProcessResult {
  outcome: "processed" | "skipped_circuit_breaker" | "no_jobs" | "error";
  picked: number;
  sent: number;
  retried: number;
  failed: number;
  cancelled: number;
  duration_ms: number;
  errors: string[];
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── Counters (module-level for timeout path access) ────────────────────────

let picked = 0;
let sent = 0;
let retried = 0;
let failed = 0;
let cancelled = 0;
let tickOutcome: ProcessResult["outcome"] = "processed";
const errors: string[] = [];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startTime = Date.now();
  picked = 0; sent = 0; retried = 0; failed = 0; cancelled = 0; errors.length = 0;
  tickOutcome = "processed";

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
    const body = await req.json().catch(() => ({}));
    const clubIdFilter: string | null = body.club_id ?? null;
    const botToken = body.bot_token ?? Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

    const tickPromise = processTick(admin, clubIdFilter, botToken, startTime);

    const timeoutPromise = new Promise<Response>((resolve) => {
      setTimeout(() => {
        console.warn(`[process-pre-announce-jobs] tick timeout ${TICK_TIMEOUT_MS}ms, returning partial`);
        tickOutcome = tickOutcome || "processed";
        resolve(json({
          outcome: tickOutcome,
          picked, sent, retried, failed, cancelled,
          duration_ms: Date.now() - startTime,
          errors: [...errors, "tick_timeout"],
        } as ProcessResult));
      }, TICK_TIMEOUT_MS);
    });

    return await Promise.race([tickPromise, timeoutPromise]);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[process-pre-announce-jobs] unhandled error:", errorMsg);
    try {
      const url = Deno.env.get("SUPABASE_URL")!;
      const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(url, service);
      await logMetric(admin, startTime, "failure", 1, 0, errorMsg);
    } catch (_) {
      // best-effort
    }
    return json({ outcome: "error", error: errorMsg, duration_ms: Date.now() - startTime } as ProcessResult, 500);
  }
});

// ── Core tick logic ────────────────────────────────────────────────────────

async function processTick(
  admin: ReturnType<typeof createClient>,
  clubIdFilter: string | null,
  botToken: string,
  startTime: number,
): Promise<Response> {
  // ═══ Step 1: Circuit breaker — recent failures ═══
  const windowStart = new Date(Date.now() - CIRCUIT_BREAKER_WINDOW_MIN * 60_000).toISOString();
  const { count: recentFailures, error: cbErr } = await admin
    .from("pre_announce_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("last_attempt_at", windowStart);

  if (cbErr) {
    errors.push(`circuit_breaker_query: ${cbErr.message}`);
  } else if ((recentFailures ?? 0) >= CIRCUIT_BREAKER_FAILURES) {
    console.warn(
      `[process-pre-announce-jobs] circuit breaker: ${recentFailures} failures in last ${CIRCUIT_BREAKER_WINDOW_MIN}min, skipping tick`,
    );
    tickOutcome = "skipped_circuit_breaker";
    await logMetric(admin, startTime, "success", 0, 0, `circuit_breaker_${recentFailures}_fails`);
    return json({
      outcome: "skipped_circuit_breaker",
      picked: 0, sent: 0, retried: 0, failed: 0, cancelled: 0,
      duration_ms: Date.now() - startTime,
      errors: [`circuit_breaker_${recentFailures}_fails`],
    } as ProcessResult);
  }

  // ═══ Step 2: Cancel expired jobs ═══
  const { count: expiredCount } = await admin
    .from("pre_announce_jobs")
    .update({ status: "cancelled", last_error: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());

  cancelled = expiredCount ?? 0;
  if (cancelled > 0) {
    console.log(`[process-pre-announce-jobs] cancelled ${cancelled} expired jobs`);
  }

  // ═══ Step 3: Pick pending jobs ═══
  let query = admin
    .from("pre_announce_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(MAX_JOBS_PER_TICK);

  if (clubIdFilter) {
    query = query.eq("club_id", clubIdFilter);
  }

  const { data: pendingJobs, error: pickErr } = await query;

  if (pickErr) {
    errors.push(`pick_query: ${pickErr.message}`);
    tickOutcome = "error";
    await logMetric(admin, startTime, "failure", 1, 0, pickErr.message);
    return json({
      outcome: "error",
      picked: 0, sent: 0, retried: 0, failed: 0, cancelled,
      duration_ms: Date.now() - startTime,
      errors: [pickErr.message],
    } as ProcessResult, 500);
  }

  if (!pendingJobs || pendingJobs.length === 0) {
    tickOutcome = "no_jobs";
    await logMetric(admin, startTime, "success", 0, 0, undefined, "no_jobs");
    return json({
      outcome: "no_jobs",
      picked: 0, sent: 0, retried: 0, failed: 0, cancelled,
      duration_ms: Date.now() - startTime,
      errors: [],
    } as ProcessResult);
  }

  picked = pendingJobs.length;
  console.log(`[process-pre-announce-jobs] picked ${picked} pending jobs`);

  // ═══ Step 4: Claim all jobs, then batch-send per chat_id ═══
  if (!botToken) {
    const jobIds = pendingJobs.map((j) => j.id);
    await admin
      .from("pre_announce_jobs")
      .update({
        status: "failed",
        attempts: 999,
        last_error: "no_telegram_bot_token",
        last_attempt_at: new Date().toISOString(),
      })
      .in("id", jobIds);
    failed = jobIds.length;
    tickOutcome = "error";
    await logMetric(admin, startTime, "failure", failed, 0, "no_telegram_bot_token");
    return json({
      outcome: "error",
      picked, sent: 0, retried: 0, failed, cancelled,
      duration_ms: Date.now() - startTime,
      errors: ["no_telegram_bot_token"],
    } as ProcessResult, 500);
  }

  // ── 4a: Claim all pending jobs atomically ──
  const claimedJobIds: string[] = [];
  const claimedMap = new Map<string, typeof pendingJobs[number]>();

  for (const job of pendingJobs) {
    const { data: claimed, error: claimErr } = await admin
      .from("pre_announce_jobs")
      .update({ status: "processing", last_attempt_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (claimErr || !claimed) continue;
    claimedJobIds.push(job.id);
    claimedMap.set(job.id, job);
  }

  if (claimedJobIds.length === 0) {
    tickOutcome = "processed";
    await logMetric(admin, startTime, "success", 0, 0, "no_claimed_jobs");
    return json({
      outcome: "processed",
      picked: 0, sent: 0, retried: 0, failed: 0, cancelled,
      duration_ms: Date.now() - startTime,
      errors: [],
    } as ProcessResult);
  }

  // ── 4b: Group claimed jobs by (chat_id, zone) ──
  const groups = new Map<string, { chatId: string; zone: string | null; jobs: typeof pendingJobs[number][] }>();
  for (const jobId of claimedJobIds) {
    const job = claimedMap.get(jobId)!;
    const key = `${job.chat_id}||${job.zone ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = { chatId: job.chat_id, zone: job.zone, jobs: [] };
      groups.set(key, group);
    }
    group.jobs.push(job);
  }

  // ── 4c: Send one batched message per group ──
  for (const [key, group] of groups) {
    const args = group.jobs.map((job) => ({
      tableName: job.table_name,
      zone: job.zone,
      outName: job.out_dealer_name ?? "Unknown",
      outUsername: job.out_dealer_username ?? null,
      inName: job.in_dealer_name,
      inUsername: job.in_dealer_username ?? null,
      swingAt: new Date(job.swing_at),
      minutesLeft: job.minutes_left,
    }));

    const message = group.jobs.length === 1
      ? formatPreAssignMessage(args[0])
      : formatBatchPreAssignMessage(args, group.zone);

    const sendResult = await sendTelegramWithTimeout(botToken, group.chatId, message, PER_JOB_TIMEOUT_MS);

    if (sendResult.ok) {
      for (const job of group.jobs) {
        await admin
          .from("pre_announce_jobs")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            attempts: (job.attempts ?? 0) + 1,
            last_error: null,
          })
          .eq("id", job.id);
      }
      sent += group.jobs.length;
    } else {
      for (const job of group.jobs) {
        const newAttempts = (job.attempts ?? 0) + 1;
        const willRetry = newAttempts < (job.max_attempts ?? 3);
        await admin
          .from("pre_announce_jobs")
          .update({
            status: willRetry ? "pending" : "failed",
            attempts: newAttempts,
            last_error: (sendResult.error ?? "send_failed_batch").substring(0, 500),
          })
          .eq("id", job.id);
        if (willRetry) { retried++; } else { failed++; }
      }
      errors.push(`batch ${key}: ${sendResult.error ?? "send failed"}`);
    }
  }

  // ═══ Step 5: Log metric ═══
  const totalErrors = failed + retried;
  const status = totalErrors === 0 ? "success" : sent > 0 ? "partial" : "failure";
  await logMetric(
    admin, startTime, status,
    totalErrors, sent,
    totalErrors > 0 ? `${failed} failed, ${retried} retried` : undefined,
  );

  return json({
    outcome: "processed",
    picked, sent, retried, failed, cancelled,
    duration_ms: Date.now() - startTime,
    errors: errors.slice(0, 5),
  } as ProcessResult);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface PreAssignMsgArgs {
  tableName: string;
  zone: string | null;
  outName: string;
  outUsername: string | null;
  inName: string;
  inUsername: string | null;
  swingAt: Date;
  minutesLeft: number;
}

function formatPreAssignLine(args: PreAssignMsgArgs): string {
  const handle = (u: string | null): string => u ? ` @${u}` : "";
  const hhmm = (d: Date): string => d.toLocaleTimeString("vi-VN", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh",
  });
  return `📋 Tiếp theo ${args.tableName}: ${args.outName}${handle(args.outUsername)} ra, ${args.inName}${handle(args.inUsername)} vào (${hhmm(args.swingAt)}, còn ${args.minutesLeft} phút)`;
}

function formatPreAssignMessage(args: PreAssignMsgArgs): string {
  const zoneLabel = args.zone ? ` - ${args.zone}` : "";
  return [
    `Có 1 cập nhật${zoneLabel}:`,
    ` ${formatPreAssignLine(args)}`,
  ].join("\n");
}

function formatBatchPreAssignMessage(items: PreAssignMsgArgs[], zone: string | null): string {
  const zoneLabel = zone ? ` - ${zone}` : "";
  const header = `Có ${items.length} cập nhật${zoneLabel}:`;
  const lines = items.map((a) => ` ${formatPreAssignLine(a)}`);
  return [header, ...lines].join("\n");
}

interface SendResult {
  ok: boolean;
  error?: string;
}

async function sendTelegramWithTimeout(
  botToken: string,
  chatId: string,
  text: string,
  timeoutMs: number,
): Promise<SendResult> {
  for (let attempt = 1; attempt <= MAX_HTTP_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: String(chatId),
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) return { ok: true };

      const errText = await res.text();
      const errMsg = `HTTP ${res.status}: ${errText.substring(0, 200)}`;

      // 4xx = client error, not transient
      if (res.status >= 400 && res.status < 500) return { ok: false, error: errMsg };

      if (attempt === MAX_HTTP_RETRIES) return { ok: false, error: errMsg };

      // Exponential backoff: 200ms, 400ms
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_HTTP_RETRIES) return { ok: false, error: `timeout/exception: ${msg}` };
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
    }
  }
  return { ok: false, error: "exhausted_retries" };
}

async function logMetric(
  admin: ReturnType<typeof createClient>,
  startTime: number,
  status: "success" | "failure" | "partial",
  errorCount: number,
  processedCount: number,
  errorMessage?: string,
  metadataNote?: string,
): Promise<void> {
  try {
    await admin.from("cron_metrics").insert({
      cron_name: "process-pre-announce-jobs",
      club_id: null,
      duration_ms: Date.now() - startTime,
      status,
      error_count: errorCount,
      processed_count: processedCount,
      error_message: errorMessage ? errorMessage.substring(0, 500) : (metadataNote ?? null),
    });
  } catch (err) {
    console.warn("[process-pre-announce-jobs] Failed to log metric:", err);
  }
}