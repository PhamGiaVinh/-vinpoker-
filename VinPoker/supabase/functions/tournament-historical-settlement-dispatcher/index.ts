import { handleOptions, jsonResp } from "../_shared/cors.ts";

// Dark invocation seam for one future cron/owner-reviewed scheduler call.
// No schedule is created here and the default environment keeps it disabled.
Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return jsonResp(req, { ok: false, message: "Method not allowed" }, 405);
  if (Deno.env.get("TRACKER_HISTORY_COMPLETION_WORKER_ENABLED") !== "true") {
    return jsonResp(req, { ok: false, code: "worker_disabled" }, 404);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey || req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
    return jsonResp(req, { ok: false, message: "Unauthorized" }, 401);
  }
  const body = await req.json().catch(() => ({})) as { limit?: unknown };
  const limit = body.limit === undefined ? 20 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    return jsonResp(req, { ok: false, code: "invalid_batch_limit" }, 400);
  }
  try {
    const response = await fetch(`${url}/functions/v1/tournament-historical-settlement-worker`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ limit }),
    });
    const result = await response.json().catch(() => ({ ok: false }));
    return jsonResp(req, result, response.status);
  } catch {
    return jsonResp(req, { ok: false, code: "worker_dispatch_failed" }, 503);
  }
});
