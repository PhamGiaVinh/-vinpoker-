/**
 * send-shift-reminders/index.ts
 *
 * Dealer Shift Planner — automated pre-shift reminders on BOTH Telegram + OneSignal
 * push. Invoked by the `dealer-shift-reminders` pg_cron job (every 5 minutes) via a
 * shared Bearer secret (migration 20261216000000, vault-sourced — mirrors the
 * online-poker cron pattern in 20260917000000).
 *
 * Two passes, both gated by `dealer_shift_reminder_config`:
 *   1. pre_shift  — dealer has a published/confirmed shift starting within
 *      `pre_shift_minutes`. DM + push once per (assignment, channel) — see the
 *      `dealer_shift_notifications` dedup ledger.
 *   2. confirm_nudge (optional) — dealer has a PUBLISHED (not yet confirmed) shift
 *      starting within `confirm_nudge_hours`. Nudges once per assignment/channel.
 *
 * Reads ONLY dealer_shift_assignments (planner layer), dealers (telegram_user_id/
 * user_id), the reminder config, and the dedup ledger. NEVER touches
 * dealer_attendance / dealer_assignments / swing_* / payroll / dealer_shift_events
 * (the payroll-bridge queue — reserved, out of scope for this feature).
 *
 * AUTHORED SOURCE-ONLY — deploy is owner-gated (added to the workflow's fixed
 * Deploy-Edge-Functions list; auto-deploys on merge to main like send-shift-schedule).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VN_TZ_MS = 7 * 3_600_000;
function fmtTimeVN(iso: string): string {
  return new Date(Date.parse(iso) + VN_TZ_MS).toISOString().slice(11, 16);
}

async function sendTelegramDM(botToken: string, chatId: number, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendOneSignalPush(
  appId: string,
  restApiKey: string,
  externalUserId: string,
  heading: string,
  message: string
): Promise<boolean> {
  try {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${restApiKey}` },
      body: JSON.stringify({
        app_id: appId,
        include_external_user_ids: [externalUserId],
        channel_for_external_user_ids: "push",
        headings: { en: heading, vi: heading },
        contents: { en: message, vi: message },
        url: "/dealer",
      }),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    // recipients===0 means no subscribed device — not an error, just nothing sent.
    return data?.recipients > 0;
  } catch {
    return false;
  }
}

interface AssignmentRow {
  id: string;
  dealer_id: string;
  scheduled_start_at: string;
  status: string;
  // Untyped Postgrest client infers a to-many shape for this embed; it is
  // actually one row (template_id FK) — read via [0].
  dealer_shift_templates: { label: string }[] | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const reminderSecret = Deno.env.get("SHIFT_REMINDERS_SECRET");
    if (!reminderSecret) return json({ error: "reminders_not_configured" }, 500);
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${reminderSecret}`) return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const oneSignalAppId = Deno.env.get("ONESIGNAL_APP_ID");
    const oneSignalKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: cfg } = await admin
      .from("dealer_shift_reminder_config")
      .select("enabled, pre_shift_minutes, confirm_nudge_enabled, confirm_nudge_hours")
      .eq("id", true)
      .maybeSingle();
    if (!cfg?.enabled) return json({ skipped: true, reason: "disabled" });

    const now = new Date();
    const results = { pre_shift: { telegram: 0, push: 0 }, confirm_nudge: { telegram: 0, push: 0 } };

    async function runPass(
      kind: "pre_shift" | "confirm_nudge",
      statuses: string[],
      windowMinutes: number
    ) {
      const highIso = new Date(now.getTime() + windowMinutes * 60_000).toISOString();
      const { data: rows, error } = await admin
        .from("dealer_shift_assignments")
        .select("id, dealer_id, scheduled_start_at, status, dealer_shift_templates(label)")
        .in("status", statuses)
        .gte("scheduled_start_at", now.toISOString())
        .lte("scheduled_start_at", highIso);
      if (error || !rows?.length) return;

      const assignmentIds = rows.map((r: AssignmentRow) => r.id);
      const { data: sentRows } = await admin
        .from("dealer_shift_notifications")
        .select("assignment_id, channel")
        .eq("kind", kind)
        .in("assignment_id", assignmentIds);
      const alreadySent = new Set((sentRows ?? []).map((s: any) => `${s.assignment_id}:${s.channel}`));

      const dealerIds = [...new Set(rows.map((r: AssignmentRow) => r.dealer_id))];
      const { data: dealers } = await admin
        .from("dealers")
        .select("id, full_name, telegram_user_id, user_id")
        .in("id", dealerIds);
      const dealerById = new Map((dealers ?? []).map((d: any) => [d.id, d]));

      for (const a of rows as AssignmentRow[]) {
        const dealer = dealerById.get(a.dealer_id);
        if (!dealer) continue;
        const label = a.dealer_shift_templates?.[0]?.label ?? "";
        const startTime = fmtTimeVN(a.scheduled_start_at);
        const minutesLeft = Math.max(0, Math.round((Date.parse(a.scheduled_start_at) - now.getTime()) / 60_000));
        const text =
          kind === "pre_shift"
            ? `⏰ Ca ${label} của bạn bắt đầu lúc ${startTime} — còn ${minutesLeft} phút.`
            : `🔔 Bạn chưa xác nhận ca ${label} hôm nay (${startTime}) — mở app hoặc nhắn /lich để xem.`;

        // Telegram DM
        if (botToken && dealer.telegram_user_id && !alreadySent.has(`${a.id}:telegram`)) {
          const ok = await sendTelegramDM(botToken, dealer.telegram_user_id, text);
          if (ok) {
            await admin
              .from("dealer_shift_notifications")
              .insert({ assignment_id: a.id, kind, channel: "telegram" });
            results[kind].telegram++;
          }
        }
        // OneSignal push
        if (oneSignalAppId && oneSignalKey && dealer.user_id && !alreadySent.has(`${a.id}:push`)) {
          const ok = await sendOneSignalPush(
            oneSignalAppId,
            oneSignalKey,
            dealer.user_id,
            kind === "pre_shift" ? "Ca sắp bắt đầu" : "Chưa xác nhận ca",
            text
          );
          if (ok) {
            await admin
              .from("dealer_shift_notifications")
              .insert({ assignment_id: a.id, kind, channel: "push" });
            results[kind].push++;
          }
        }
      }
    }

    await runPass("pre_shift", ["published", "confirmed"], cfg.pre_shift_minutes);
    if (cfg.confirm_nudge_enabled) {
      await runPass("confirm_nudge", ["published"], cfg.confirm_nudge_hours * 60);
    }

    return json({ outcome: "sent", results });
  } catch (e) {
    return json({ error: "internal", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
