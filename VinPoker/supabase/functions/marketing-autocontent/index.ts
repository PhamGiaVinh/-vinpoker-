/**
 * marketing-autocontent (MKT-7 Part 2)
 *
 * Every 30 min (pg_cron), for each club with an enabled marketing_auto_jobs row, generate marketing
 * post DRAFTS from ops data — never auto-sends. Owner reviews + publishes in the Posts tab.
 * Kinds: schedule (tomorrow's tournaments), livestream (a stream is live), overlay (tournament in
 * GTD overlay). Public data only (no player names). Idempotent via deterministic client_request_id
 * (one draft per key; marketing_create_auto_draft does ON CONFLICT DO NOTHING).
 *
 * Auth: the cron calls with the anon Bearer (gate only); this fn uses the SERVICE-ROLE key to call
 * the service-role RPC marketing_create_auto_draft (P1-5).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { ddmm, fmtTimeVN, formatVND, vnDateStr, vnHour } from "./fmt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const price = (t: any) => (t.buy_in ?? 0) + (t.rake_amount ?? 0) + (t.service_fee_amount ?? 0);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startTime = Date.now();
  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!url || !service) return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
    const admin = createClient(url, service);

    const { data: jobs, error: jErr } = await admin
      .from("marketing_auto_jobs")
      .select("club_id, kinds, channels")
      .eq("enabled", true);
    if (jErr) return json({ outcome: "error", error: jErr.message, duration_ms: Date.now() - startTime }, 500);
    if (!jobs || jobs.length === 0) return json({ outcome: "no_clubs", duration_ms: Date.now() - startTime });

    let created = 0;
    const errors: string[] = [];
    for (const job of jobs as any[]) {
      const kinds: string[] = job.kinds ?? [];
      const channels = job.channels ?? [];
      if (!Array.isArray(channels) || channels.length === 0) continue;
      try {
        if (kinds.includes("schedule") && vnHour() >= 6 && vnHour() < 9) {
          created += await genSchedule(admin, job.club_id, channels) ? 1 : 0;
        }
        if (kinds.includes("livestream")) created += await genLivestream(admin, job.club_id, channels);
        if (kinds.includes("overlay")) created += await genOverlay(admin, job.club_id, channels);
      } catch (e) {
        errors.push(`club ${job.club_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return json({ outcome: "generated", posts_created: created, duration_ms: Date.now() - startTime, errors: errors.slice(0, 5) });
  } catch (err) {
    return json({ outcome: "error", error: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - startTime }, 500);
  }
});

async function draft(admin: any, club: string, kind: string, title: string, body: string, channels: unknown, sourceRef: unknown, key: string): Promise<boolean> {
  const { data } = await admin.rpc("marketing_create_auto_draft", {
    p_club_id: club, p_kind: kind, p_title: title, p_body: body,
    p_channels: channels, p_source_ref: sourceRef, p_client_request_id: key,
  });
  return data?.status === "ok";
}

// schedule — tomorrow's scheduled tournaments (P2-7: only called in the 06:00-09:00 VN window).
async function genSchedule(admin: any, club: string, channels: unknown): Promise<boolean> {
  const tomorrow = vnDateStr(1), dayAfter = vnDateStr(2);
  const { data: tours } = await admin
    .from("tournaments")
    .select("name, start_time, buy_in, rake_amount, service_fee_amount, guarantee_amount")
    .eq("club_id", club).eq("status", "scheduled")
    .gte("start_time", `${tomorrow}T00:00:00+07:00`).lt("start_time", `${dayAfter}T00:00:00+07:00`)
    .order("start_time", { ascending: true });
  if (!tours || tours.length === 0) return false;
  const lines = (tours as any[]).map((t) =>
    `• ${fmtTimeVN(t.start_time)} ${t.name} — Buy-in ${formatVND(price(t))}` +
    (t.guarantee_amount ? ` · GTD ${formatVND(Number(t.guarantee_amount))}` : ""));
  const body = `📅 Lịch giải ngày mai (${ddmm(tomorrow)}):\n` + lines.join("\n");
  return draft(admin, club, "schedule", "📅 Lịch giải ngày mai", body, channels,
    { kind: "schedule", date: tomorrow }, `auto:schedule:${club}:${tomorrow}`);
}

// livestream — a club tournament currently broadcasting (is_live). One draft per stream id (P2-11).
async function genLivestream(admin: any, club: string, channels: unknown): Promise<number> {
  const { data: streams } = await admin
    .from("tournament_streams")
    .select("id, stream_url, tournaments!inner(name, club_id)")
    .eq("is_live", true).eq("tournaments.club_id", club);
  let n = 0;
  for (const s of (streams as any[] ?? [])) {
    const name = s.tournaments?.name ?? "Giải đấu";
    const body = `🔴 ĐANG TRỰC TIẾP: ${name}\nXem ngay: ${s.stream_url}`;
    if (await draft(admin, club, "livestream", "🔴 Đang trực tiếp", body, channels,
      { kind: "livestream", stream_id: s.id }, `auto:livestream:${s.id}`)) n++;
  }
  return n;
}

// overlay — tournaments starting within 12h whose confirmed prize pool < GTD. Snapshot value (P1-3).
async function genOverlay(admin: any, club: string, channels: unknown): Promise<number> {
  const nowIso = new Date().toISOString();
  const endIso = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
  const { data: tours } = await admin
    .from("tournaments")
    .select("id, name, start_time, buy_in, rake_amount, service_fee_amount, guarantee_amount")
    .eq("club_id", club).eq("status", "scheduled")
    .not("guarantee_amount", "is", null)
    .gte("start_time", nowIso).lt("start_time", endIso);
  let n = 0;
  for (const t of (tours as any[] ?? [])) {
    const { data: regs } = await admin
      .from("tournament_registrations").select("buy_in").eq("tournament_id", t.id).eq("status", "confirmed");
    const pool = (regs as any[] ?? []).reduce((s, r) => s + (r.buy_in ?? 0), 0);
    const overlay = Number(t.guarantee_amount) - pool;
    if (overlay <= 0) continue;
    const body = `⚡ ${t.name} còn OVERLAY ${formatVND(overlay)}!\n` +
      `Buy-in ${formatVND(price(t))}, bắt đầu ${fmtTimeVN(t.start_time)}. Vào nhanh kẻo lỡ!\n` +
      `(số liệu tính lúc ${fmtTimeVN(nowIso)})`;
    if (await draft(admin, club, "overlay", "⚡ Overlay", body, channels,
      { kind: "overlay", tournament_id: t.id }, `auto:overlay:${t.id}:${vnDateStr(0)}`)) n++;
  }
  return n;
}
