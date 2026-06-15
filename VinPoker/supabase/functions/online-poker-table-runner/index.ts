// supabase/functions/online-poker-table-runner/index.ts
//
// GE-2K — table runner Edge function (cron-invoked, service-role). Deals the next hand at
// every table that is due (open · no active hand · >=2 funded seated · cooldown elapsed),
// running the TS engine here (the only place it may run) and persisting via op_start_hand.
// The eligibility query + per-table deal live in ../_shared/pokerRuntime (unit-tested);
// this file is only the Deno.serve transport + cron-secret auth.
//
// SECURITY (mirrors online-poker-timeout-sweep):
//   * Invoked by pg_cron (net.http_post), NOT by users → no user JWT. Requires the shared
//     secret OP_TABLE_RUNNER_SECRET; without it → 401. (This secret IS the auth.)
//   * SERVICE-ROLE client for op_* (service-role-only grants).
//   * Fail-closed: runTableRunner no-ops while online_poker_config.enabled is false.
//   G1: never log deck / board_future / holes / hole cards / private views — only counts.
//
// SOURCE-ONLY in GE-2K: NOT added to the deploy workflow, NOT scheduled, NO secret set.
// Deploy + schedule + secret are Phase-D (see docs/online-poker/GE2K_TABLE_RUNNER_IMPLEMENTATION.md).

import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { retryFetch } from "../_shared/retry.ts";
import { handleOptions, jsonResp } from "../_shared/cors.ts";
import { runTableRunner, type RunnerResult } from "../_shared/pokerRuntime/tableRunner.ts";
import type { AdminClient } from "../_shared/pokerRuntime/dealNextHand.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const json = (data: unknown, status = 200) => jsonResp(req, data, status);

  try {
    // Cron-only auth: a shared secret, NOT a user JWT.
    const secret = Deno.env.get("OP_TABLE_RUNNER_SECRET");
    const auth = req.headers.get("Authorization") ?? "";
    if (!secret || auth !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);

    // Optional body: { dryRun?: boolean, limit?: number }
    let dryRun = false;
    let limit = 50;
    try {
      const body = await req.json();
      if (body && typeof body === "object") {
        dryRun = body.dryRun === true;
        if (Number.isInteger(body.limit) && body.limit > 0) limit = Math.min(body.limit, 200);
      }
    } catch { /* no/invalid body → defaults */ }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { global: { fetch: retryFetch } });

    const result: RunnerResult = await runTableRunner(admin as unknown as AdminClient, { limit, dryRun });
    return json(result, 200);
  } catch (_e) {
    console.error("[online-poker-table-runner] unexpected error"); // G1: no internals
    return json({ error: "internal error" }, 500);
  }
});
