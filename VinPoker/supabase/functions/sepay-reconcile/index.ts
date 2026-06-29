// SePay ingestion — Patch 2 (Direction 1): reconcile worker.
//
// Cron-invoked (every ~5 min). For each ACTIVE club it pulls the SePay v2 transactions API (the
// SOURCE OF TRUTH), stamps the matching bank_transactions rows api-verified (+ recovers webhook
// misses / quarantined rows), then runs settle_bank_transaction(bt, SEPAY_AUTO_CONFIRM) over the
// verified worklist. In Direction 1 SEPAY_AUTO_CONFIRM is false → settle is FLAG-ONLY: a discrepancy
// is flagged for the cashier, an exact match is left for the cashier to confirm in the Settlement UI.
//
// AUTH: gated by a single shared secret. The cron passes `X-Reconcile-Secret`; we timing-safe-compare
// it to Deno.env SEPAY_RECONCILE_SECRET. Deployed --no-verify-jwt (the cron has no Supabase user JWT).
// The secret is NEVER logged. (Owner sets the SAME value in the Function env AND in Vault for the cron.)
//
// SECRETS / PII: per-club SePay API tokens are read from Vault via sepay_get_club_api_token (service-
// role) and used only in the Authorization header — never logged. The pulled transaction_content holds
// payer names (PII); it is stored in bank_transactions (raw_payload) and carried under the Patch-2
// retention/purge TODO (P2-E) — NOT redacted here.
//
// KILL-SWITCH: SEPAY_AUTO_CONFIRM (env, default false) is the authoritative auto-confirm switch. It is
// read here (not hardcoded) so flipping it never requires a code change/redeploy. NOTE: even if set to
// true today, settle still cannot auto-confirm because confirm_registration_and_assign_seat (P0-guard-v2)
// rejects a headless caller (auth.uid()=NULL) — the auto path (Hướng 2) is not built. So this env is
// inert-safe today; it is wired in the correct place for the future.
//
// RESILIENCE: one club failing (bad token, SePay down, 4xx) records last_pull_error and is SKIPPED —
// the loop continues; the webhook keeps capturing realtime. retryFetch handles 429/5xx/network.
//
// INERT until activated: until the owner configures a club via sepay_set_club_payment_config (token →
// Vault, is_active=true), sepay_get_active_payment_clubs returns nothing → this worker no-ops.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { retryFetch } from "../_shared/retry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RECONCILE_SECRET = Deno.env.get("SEPAY_RECONCILE_SECRET") ?? "";
const AUTO_CONFIRM = (Deno.env.get("SEPAY_AUTO_CONFIRM") ?? "false").trim().toLowerCase() === "true";
// Production: https://userapi.sepay.vn · Sandbox: https://userapi-sandbox.sepay.vn (set SEPAY_API_BASE).
const SEPAY_API_BASE = (Deno.env.get("SEPAY_API_BASE") ?? "https://userapi.sepay.vn").replace(/\/+$/, "");

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const MAX_PAGES = 5;                          // cap pages/club/tick (anti-runaway)
const PAGE_LIMIT = 100;
const OVERLAP_MS = 60 * 60 * 1000;            // re-pull the last 1h to cover the date boundary
const FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000; // first pull (no last_pull_at) → back 24h
const SETTLE_BATCH = 500;                     // cap settle calls/club/tick

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}
/** Constant-time equality via SHA-256 digests (no early-exit, no length leak). */
async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

function nonEmpty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
/** SePay amount may be a number or a decimal string → bigint VND (or null). */
function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}
/** SePay transaction_date "YYYY-MM-DD HH:MM:SS" is VN time, no offset; VN has no DST → +07:00. */
function parseOccurredAt(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const d = new Date(v.trim().replace(" ", "T") + "+07:00");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** VN calendar date (YYYY-MM-DD) for the SePay transaction_date_from filter (date-granular). */
function vnDateString(epochMs: number): string {
  return new Date(epochMs + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Map one SePay v2 transaction to the bank_transactions ingest shape (sent to the ingest RPC). */
function mapTxn(t: Record<string, unknown>) {
  const transferType = nonEmpty(t["transfer_type"]);
  const amount = transferType === "out" ? parseAmount(t["amount_out"]) : parseAmount(t["amount_in"]);
  return {
    provider_txn_id: nonEmpty(t["id"]),
    account_number: nonEmpty(t["account_number"]),
    sub_account: nonEmpty(t["va"]),
    gateway: nonEmpty(t["bank_brand_name"]),
    amount,
    transfer_type: transferType,
    content: typeof t["transaction_content"] === "string" ? (t["transaction_content"] as string) : null,
    txn_ref: nonEmpty(t["reference_number"]),
    occurred_at: parseOccurredAt(t["transaction_date"]),
    raw_payload: t,
  };
}

/** Pull up to MAX_PAGES of one account's transactions since fromDate. Throws on a non-OK HTTP status
 *  (e.g. 401 bad token) so the caller flags+skips this club. retryFetch handles 429/5xx/network. */
async function pullClubTransactions(masterAccount: string, token: string, fromDate: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${SEPAY_API_BASE}/v2/transactions?account_number=${encodeURIComponent(masterAccount)}` +
      `&transaction_date_from=${fromDate}&limit=${PAGE_LIMIT}&page=${page}`;
    const res = await retryFetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`sepay_api_${res.status}`); // do NOT include the body (may carry account info)
    const body = await res.json().catch(() => null) as { data?: unknown; meta?: { pagination?: { current_page?: number; last_page?: number; has_more?: boolean } } } | null;
    const data = Array.isArray(body?.data) ? body!.data as Record<string, unknown>[] : [];
    out.push(...data);
    const pg = body?.meta?.pagination;
    const hasMore = pg?.has_more === true ||
      (typeof pg?.current_page === "number" && typeof pg?.last_page === "number" && pg.current_page < pg.last_page);
    if (data.length === 0 || !hasMore) break;
  }
  return out;
}

Deno.serve(async (req) => {
  // 1) Method gate.
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // 2) Shared-secret gate (timing-safe). Never log the secret.
  const presented = (req.headers.get("X-Reconcile-Secret") ?? "").trim();
  const authed = RECONCILE_SECRET.length > 0 && presented.length > 0 &&
    (await timingSafeEqualStr(presented, RECONCILE_SECRET));
  if (!authed) return new Response("Unauthorized", { status: 401 });

  // 3) Active clubs (service-role RPC; returns only club_id + master_account_number, no secret).
  const { data: clubs, error: clubsErr } = await admin.rpc("sepay_get_active_payment_clubs");
  if (clubsErr) {
    console.error("sepay-reconcile: active-clubs query failed:", clubsErr.message);
    return jsonResponse(500, { ok: false, error: "clubs_query_failed" });
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const summary: Array<Record<string, unknown>> = [];
  let totalSettled = 0;

  for (const club of (clubs ?? []) as Array<{ club_id: string; master_account_number: string | null }>) {
    const clubId = club.club_id;
    const master = nonEmpty(club.master_account_number);
    try {
      if (!master) throw new Error("no_master_account_number");

      // Window: from last_pull_at − overlap, else first pull → back 24h. (Service-role read; non-secret
      // column only. If it errors, cfg stays undefined → safe 24h fallback.)
      let fromMs = nowMs - FIRST_LOOKBACK_MS;
      const { data: cfg } = await admin.from("club_payment_config")
        .select("last_pull_at").eq("club_id", clubId).maybeSingle();
      if (cfg?.last_pull_at) {
        const lp = new Date(cfg.last_pull_at as string).getTime();
        if (Number.isFinite(lp)) fromMs = lp - OVERLAP_MS;
      }
      const fromDate = vnDateString(fromMs);

      // Per-club SePay token (Vault, service-role). Never logged.
      const { data: token, error: tokErr } = await admin.rpc("sepay_get_club_api_token", { p_club_id: clubId });
      if (tokErr) throw new Error("token_read_failed");
      if (!token) throw new Error("no_api_token");

      // Pull (paged, retry, rate-limit-aware) → map → drop rows lacking dedupe identity.
      const raw = await pullClubTransactions(master, token as string, fromDate);
      const rows = raw.map(mapTxn).filter((r) => r.provider_txn_id && r.account_number);

      // Ingest: verify existing + insert misses + backfill quarantined NULLs, WITHOUT resetting status
      // (matched/ignored preserved) and WITHOUT re-writing already-verified rows. See the ingest RPC.
      if (rows.length > 0) {
        const { error: ingErr } = await admin.rpc("sepay_ingest_verified_transactions", { p_txns: rows });
        if (ingErr) throw new Error(`ingest_failed:${ingErr.message}`);
      }

      // Worklist: incoming, SePay-API-verified, still unmatched, for this club's master account.
      const { data: worklist, error: wlErr } = await admin.from("bank_transactions")
        .select("id")
        .eq("provider", "sepay")
        .eq("account_number", master)
        .eq("status", "unmatched")
        .eq("transfer_type", "in")
        .not("api_verified_at", "is", null)
        .limit(SETTLE_BATCH);
      if (wlErr) throw new Error(`worklist_failed:${wlErr.message}`);

      let settled = 0;
      for (const bt of (worklist ?? []) as Array<{ id: string }>) {
        const { error: sErr } = await admin.rpc("settle_bank_transaction", {
          p_bank_transaction_id: bt.id,
          p_auto_confirm: AUTO_CONFIRM,
        });
        if (sErr) { console.error("sepay-reconcile: settle failed", bt.id, sErr.message); continue; }
        settled++;
      }
      totalSettled += settled;

      // Record pull state (best-effort observability; service-role write).
      await admin.from("club_payment_config")
        .update({ last_pull_at: nowIso, last_pull_status: "ok", last_pull_error: null })
        .eq("club_id", clubId);
      summary.push({ club_id: clubId, pulled: rows.length, settled, status: "ok" });
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      console.error("sepay-reconcile: club failed", clubId, msg);
      await admin.from("club_payment_config")
        .update({ last_pull_status: "error", last_pull_error: msg.slice(0, 500) })
        .eq("club_id", clubId);
      summary.push({ club_id: clubId, status: "error", error: msg });
      // continue with the next club
    }
  }

  return jsonResponse(200, { ok: true, clubs: summary.length, settled: totalSettled, auto_confirm: AUTO_CONFIRM, results: summary });
});
