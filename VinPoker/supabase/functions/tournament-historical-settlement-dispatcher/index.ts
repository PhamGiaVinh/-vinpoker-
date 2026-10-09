import { handleOptions, jsonResp } from "../_shared/cors.ts";
import { parseHistoryWorkerHandIds, TRACKER_HISTORY_WORKER_MAX_BATCH } from "../_shared/trackerSettlement/historyWorkerPolicy.ts";
import { authorizeHistoryWorker, HISTORY_CANARY_SECRET_ENV } from "../_shared/trackerSettlement/historyWorkerAuth.ts";

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
  const canarySecret = Deno.env.get(HISTORY_CANARY_SECRET_ENV);
  const authority = authorizeHistoryWorker(req, serviceKey, canarySecret);
  if (!url || !serviceKey || !authority.ok) {
    return jsonResp(req, { ok: false, message: "Unauthorized" }, 401);
  }
  let parsed: unknown;
  try { parsed = await req.json(); }
  catch { return jsonResp(req, { ok: false, code: "invalid_worker_request" }, 400); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return jsonResp(req, { ok: false, code: "invalid_worker_request" }, 400);
  }
  const body = parsed as { limit?: unknown; hand_ids?: unknown };
  let handIds: string[] | undefined;
  try { handIds = parseHistoryWorkerHandIds(body.hand_ids); }
  catch { return jsonResp(req, { ok: false, code: "invalid_hand_scope" }, 400); }
  if (authority.scopedOnly && !handIds) {
    return jsonResp(req, { ok: false, code: "hand_scope_required" }, 400);
  }
  const limit = body.limit === undefined ? TRACKER_HISTORY_WORKER_MAX_BATCH : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > TRACKER_HISTORY_WORKER_MAX_BATCH) {
    return jsonResp(req, { ok: false, code: "invalid_batch_limit" }, 400);
  }
  try {
    const response = await fetch(`${url}/functions/v1/tournament-historical-settlement-worker`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authority.scopedOnly ? canarySecret : serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ limit, ...(handIds ? { hand_ids: handIds } : {}) }),
    });
    const result = await response.json().catch(() => ({ ok: false }));
    return jsonResp(req, result, response.status);
  } catch {
    return jsonResp(req, { ok: false, code: "worker_dispatch_failed" }, 503);
  }
});
