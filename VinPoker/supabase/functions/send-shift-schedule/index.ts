/**
 * send-shift-schedule/index.ts
 *
 * Dealer Shift Planner — broadcast a published schedule IMAGE to Telegram.
 *   • Frontend renders the schedule to a PNG and POSTs it here (base64).
 *   • This function holds TELEGRAM_BOT_TOKEN (never exposed to the client).
 *   • Authorizes the caller as club control/admin of the target club.
 *   • sendPhoto → (1) the club floor/group chat, (2) each dealer's DM.
 *
 * Reads ONLY club_settings + dealers (telegram_user_id). Never touches
 * dealer_assignments / dealer_attendance / swing_* / payroll.
 *
 * AUTHORED SOURCE-ONLY — deploy is owner-gated (supabase functions deploy).
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

function decodeBase64Png(input: string): Uint8Array {
  const b64 = input.includes(",") ? input.split(",")[1] : input;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sendPhoto(
  botToken: string,
  chatId: string,
  png: Uint8Array,
  caption: string
): Promise<boolean> {
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    form.append("photo", new Blob([png as BlobPart], { type: "image/png" }), "schedule.png");
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface Recipient {
  dealer_id: string;
  shift_label?: string; // e.g. "08–16 (08:00–16:00)"
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ error: "telegram_not_configured" }, 500);

    const admin = createClient(supabaseUrl, serviceKey);

    // Identify the caller from their JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const club_id: string = body.club_id;
    const work_date: string = body.work_date;
    const image_base64: string = body.image_base64;
    const caption_title: string | undefined = body.caption_title;
    const recipients: Recipient[] = Array.isArray(body.recipients) ? body.recipients : [];
    if (!club_id || !work_date || !image_base64) return json({ error: "bad_request" }, 400);

    // Authorize: caller must be club dealer-control / club-admin / super-admin.
    const [{ data: isCtrl }, { data: isAdmin }] = await Promise.all([
      admin.rpc("is_club_dealer_control", { _user_id: user.id, _club_id: club_id }),
      admin.rpc("is_club_admin", { _user_id: user.id, _club_id: club_id }),
    ]);
    if (!isCtrl && !isAdmin) return json({ error: "forbidden" }, 403);

    const png = decodeBase64Png(image_base64);
    const title = caption_title ?? `🗓️ Lịch dealer ngày ${work_date}`;

    // 1) Group / floor chat.
    let groupSent = false;
    const { data: cs } = await admin
      .from("club_settings")
      .select("floor_manager_chat_id, telegram_chat_id")
      .eq("club_id", club_id)
      .maybeSingle();
    const groupChat = (cs as any)?.floor_manager_chat_id ?? (cs as any)?.telegram_chat_id ?? null;
    if (groupChat) groupSent = await sendPhoto(botToken, String(groupChat), png, title);

    // 2) Per-dealer DM (only dealers that have linked Telegram).
    let dmSent = 0;
    let dmSkipped = 0;
    const dealerIds = [...new Set(recipients.map((r) => r.dealer_id).filter(Boolean))];
    if (dealerIds.length > 0) {
      const { data: dealers } = await admin
        .from("dealers")
        .select("id, telegram_user_id, full_name")
        .in("id", dealerIds);
      const byId = new Map<string, any>((dealers ?? []).map((d: any) => [d.id, d]));
      for (const r of recipients) {
        const d = byId.get(r.dealer_id);
        if (!d?.telegram_user_id) { dmSkipped++; continue; }
        const cap = r.shift_label
          ? `🗓️ Lịch ngày ${work_date}\n👉 Ca của bạn: <b>${r.shift_label}</b>`
          : title;
        const ok = await sendPhoto(botToken, String(d.telegram_user_id), png, cap);
        if (ok) dmSent++; else dmSkipped++;
      }
    }

    return json({
      outcome: "sent",
      group_sent: groupSent,
      group_configured: !!groupChat,
      dm_sent: dmSent,
      dm_skipped: dmSkipped,
    });
  } catch (e) {
    return json({ error: "internal", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
