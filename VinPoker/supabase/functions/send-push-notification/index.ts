import {
  authorizeInternalTrigger,
  getIdempotencyKey,
  parsePushPayload,
} from "../_shared/internal-trigger-auth.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalTrigger(req);
  if (!auth.ok) return json({ error: auth.code }, auth.status);

  if (!getIdempotencyKey(req)) return json({ error: "invalid_idempotency_key" }, 400);

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 4096) {
    return json({ error: "payload_too_large" }, 413);
  }

  const payload = parsePushPayload(await req.json().catch(() => null));
  if (!payload) return json({ error: "invalid_payload" }, 400);

  const appId = Deno.env.get("ONESIGNAL_APP_ID");
  const apiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  if (!appId || !apiKey) return json({ error: "push_not_configured" }, 503);

  const notification: Record<string, unknown> = {
    app_id: appId,
    include_external_user_ids: [payload.userId],
    channel_for_external_user_ids: "push",
    headings: { en: payload.heading, vi: payload.heading },
    contents: { en: payload.message, vi: payload.message },
  };
  if (payload.url) notification.url = payload.url;

  try {
    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify(notification),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) return json({ error: "push_provider_failed" }, 502);
    return json({ ok: true, recipients: Number(data?.recipients ?? 0) }, 200);
  } catch {
    return json({ error: "push_provider_failed" }, 502);
  }
});
