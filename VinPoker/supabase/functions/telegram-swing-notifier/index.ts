import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    if (!botToken) return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);

    const admin = createClient(url, service);

    const body = await req.json().catch(() => ({}));
    const { chat_id, message, parse_mode, club_id, audit_actor_id } = body ?? {};
    if (!chat_id || !message) return json({ error: "chat_id and message required" }, 400);

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(chat_id),
        text: message,
        parse_mode: parse_mode || "HTML",
        disable_web_page_preview: true,
      }),
    });

    const tgBody = await tgRes.text();

    if (!tgRes.ok) {
      console.error("Telegram API error:", tgRes.status, tgBody);

      if (club_id) {
        await admin.from("audit_logs").insert({
          club_id,
          actor_id: audit_actor_id ?? null,
          action: "telegram_failed",
          entity_type: "telegram_swing_notifier",
          payload: { error: tgBody, chat_id, message },
        });
      }

      return json({ error: "Telegram send failed", detail: tgBody }, 502);
    }

    return json({ success: true, telegram_response: JSON.parse(tgBody) });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
