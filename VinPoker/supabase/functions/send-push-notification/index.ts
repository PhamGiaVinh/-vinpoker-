import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID") ?? "a54eec09-b2a7-4773-9a75-719695aa059d";
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!ONESIGNAL_REST_API_KEY) {
      return json({ error: "ONESIGNAL_REST_API_KEY is not configured" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const { user_id, heading, message, url } = body ?? {};

    if (!user_id || typeof user_id !== "string") return json({ error: "user_id required" }, 400);
    if (!heading || typeof heading !== "string") return json({ error: "heading required" }, 400);
    if (!message || typeof message !== "string") return json({ error: "message required" }, 400);

    const payload: Record<string, unknown> = {
      app_id: ONESIGNAL_APP_ID,
      include_external_user_ids: [user_id],
      channel_for_external_user_ids: "push",
      headings: { en: heading, vi: heading },
      contents: { en: message, vi: message },
    };
    if (url && typeof url === "string") payload.url = url;

    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ error: "OneSignal API error", status: res.status, details: data }, 502);
    }

    // OneSignal returns recipients=0 if the external_user_id isn't subscribed
    if (data?.recipients === 0) {
      return json({
        ok: false,
        warning: "No subscribed devices found for this user. Make sure you've enabled notifications and are logged in.",
        details: data,
      }, 200);
    }

    return json({ ok: true, details: data }, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
