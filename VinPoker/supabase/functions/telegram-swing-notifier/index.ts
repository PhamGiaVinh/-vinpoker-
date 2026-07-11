import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authenticateUser } from "../_shared/staking-common.ts";

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
    const authResult = await authenticateUser(req);
    if (authResult instanceof Response) return authResult;
    const uid = authResult.uid;

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    if (!botToken) return json({ error: "TELEGRAM_BOT_TOKEN not configured" }, 500);

    const admin = createClient(url, service);

    const body = await req.json().catch(() => ({}));
    let { chat_id, message, parse_mode, club_id } = body ?? {};
    if (!chat_id || !message) return json({ error: "chat_id and message required" }, 400);
    if (!club_id) return json({ error: "club_id required" }, 400);
    if (chat_id !== "__club__") return json({ error: "Only the configured club chat is allowed" }, 400);
    if (typeof message !== "string" || message.length > 4096) return json({ error: "message too long" }, 400);

    const { data: isControl } = await admin.rpc("is_club_dealer_control", {
      _user_id: uid,
      _club_id: club_id,
    });
    if (!isControl) return json({ error: "Forbidden" }, 403);

    // Resolve __club__ placeholder to actual telegram_chat_id from club_settings
    if (chat_id === "__club__" && club_id) {
      const { data: cs } = await admin
        .from("club_settings")
        .select("telegram_chat_id")
        .eq("club_id", club_id)
        .maybeSingle();
      const resolved = (cs as any)?.telegram_chat_id;
      if (!resolved) return json({ error: "CLUB_TELEGRAM_CHAT_NOT_CONFIGURED" }, 400);
      chat_id = resolved;
    }

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
          actor_id: uid,
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
