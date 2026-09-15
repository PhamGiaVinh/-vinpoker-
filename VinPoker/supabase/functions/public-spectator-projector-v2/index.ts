import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reducePublicSpectatorPayload } from "../_shared/publicSpectatorReducer.ts";

type WorkGroup = {
  tournament_id: string;
  component: "tables" | "ranking" | "payout" | "visibility";
  group_key: string;
  fencing_token: string;
};

const headers = { "Content-Type": "application/json" };

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
  const expected = Deno.env.get("PUBLIC_SPECTATOR_WORKER_SECRET") ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || supplied !== expected) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return new Response(JSON.stringify({ error: "server_configuration" }), { status: 500, headers });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const deadline = Date.now() + 5_000;
  const rpcBeforeDeadline = async (name: string, args: Record<string, unknown>) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("deadline_exceeded");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      return await supabase.rpc(name, args).abortSignal(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };
  const { data, error } = await rpcBeforeDeadline("claim_public_spectator_projection_v2", { p_limit: 50 });
  if (error) return new Response(JSON.stringify({ error: "claim_failed" }), { status: 500, headers });
  const jobs = (Array.isArray(data) ? data : []) as WorkGroup[];
  let cursor = 0;
  const results: Array<{ key: string; published: boolean; error?: string }> = [];

  async function worker() {
    while (cursor < jobs.length && Date.now() < deadline) {
      const job = jobs[cursor++];
      const key = `${job.tournament_id}:${job.component}:${job.group_key}`;
      try {
        const { data: source, error: sourceError } = await rpcBeforeDeadline("get_public_spectator_projection_source_v2", {
          p_tournament_id: job.tournament_id,
          p_component: job.component,
          p_fencing_token: job.fencing_token,
        });
        if (sourceError || !source) throw new Error("source_failed");
        const sourceRecord = source as { sourceVector: Record<string, string>; payload: unknown };
        const { data: published, error: publishError } = await rpcBeforeDeadline("publish_public_spectator_projection_v2", {
          p_tournament_id: job.tournament_id,
          p_component: job.component,
          p_group_key: job.group_key,
          p_fencing_token: job.fencing_token,
          p_source_vector: sourceRecord.sourceVector,
          p_payload: reducePublicSpectatorPayload(job.component, sourceRecord.payload),
        });
        if (publishError) throw new Error("publish_failed");
        results.push({ key, published: published === true });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "unknown";
        if (Date.now() < deadline) {
          try {
            await rpcBeforeDeadline("fail_public_spectator_projection_v2", {
              p_tournament_id: job.tournament_id,
              p_component: job.component,
              p_group_key: job.group_key,
              p_fencing_token: job.fencing_token,
              p_error: message,
            });
          } catch { /* The database lease makes an interrupted failure report retryable. */ }
        }
        results.push({ key, published: false, error: message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, () => worker()));
  return new Response(JSON.stringify({ claimed: jobs.length, processed: results.length, results }), { status: 200, headers });
});
