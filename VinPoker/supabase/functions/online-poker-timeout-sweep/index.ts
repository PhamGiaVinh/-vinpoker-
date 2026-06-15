// supabase/functions/online-poker-timeout-sweep/index.ts
//
// PR C — timeout-sweep hardening. Cron-invoked, service-role sweep so an AFK /
// disconnected player cannot stall a table. For every hand past its act_deadline it
// forces the to-act seat's auto-action (check-if-free-else-fold) through the SAME
// authoritative path as a real action (op_load_action_context → engine applyAction →
// op_submit_action). The engine runs ONLY here (Edge). The runtime stays DARK until
// online_poker_config.enabled is true; while dark this is a no-op ("disabled").
//
// SECURITY:
//   * Invoked by pg_cron (net.http_post), NOT by users → no user JWT. It requires a
//     shared secret header OP_TIMEOUT_SWEEP_SECRET; without it → 401. (Deployed with
//     --no-verify-jwt like the other functions; this secret IS the auth.)
//   * Uses the SERVICE-ROLE client for op_* (service-role-only grants).
//   * Idempotency: key = `timeout_<hand_id>_<state_version>` → re-running the sweep
//     replays the stored response (no double-action); a stale state_version (the player
//     acted in time) fails the CAS → race_lost → correctly NOT applied.
//   G1: never log deck / board_future / holes / hole cards / private views.
//
// SOURCE-ONLY in PR C: NOT added to the deploy workflow and NOT scheduled (the cron
// migration is authored but not applied). Deploy + schedule + secret are Phase-D.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.105.4";
import { retryFetch } from "../_shared/retry.ts";
import { corsHeaders, handleOptions, jsonResp } from "../_shared/cors.ts";
import { applyAction, forcedTimeoutAction } from "../_shared/pokerEngine/index.ts";
import {
  serializeAuthoritative, deserializeAuthoritative, actionToRow,
} from "../_shared/pokerAdapter/index.ts";

const ACT_TIMEOUT_SECS = 30;
const MAX_HANDS_PER_RUN = 200; // safety cap per sweep

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  const json = (data: unknown, status = 200) => jsonResp(req, data, status);

  try {
    // Cron-only auth: a shared secret, NOT a user JWT.
    const secret = Deno.env.get("OP_TIMEOUT_SWEEP_SECRET");
    const auth = req.headers.get("Authorization") ?? "";
    if (!secret || auth !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { global: { fetch: retryFetch } });

    // Dark switch: refuse while disabled (also covers "migration unapplied").
    const { data: enabled, error: enErr } = await admin.rpc("op_is_enabled");
    if (enErr || enabled !== true) return json({ outcome: "disabled", swept: 0 }, 200);

    const { data: sweep, error: swErr } = await admin.rpc("op_timeout_sweep");
    if (swErr || !sweep || sweep.outcome !== "ok") return json({ outcome: "sweep_failed", swept: 0 }, 200);

    const hands: Array<{ hand_id: string }> = (sweep.hands ?? []).slice(0, MAX_HANDS_PER_RUN);
    let forced = 0, skipped = 0, raceLost = 0;

    for (const h of hands) {
      try {
        const { data: ctx, error: lErr } = await admin.rpc("op_load_action_context", { p_hand_id: h.hand_id });
        if (lErr || !ctx || ctx.outcome !== "ok") { skipped++; continue; }

        const state = deserializeAuthoritative(ctx.state, ctx.live_deck ?? [], ctx.holes ?? []);
        if (state.toAct == null) { skipped++; continue; } // nothing to force

        const seat = state.seats.find((s) => s.seat === state.toAct);
        if (!seat) { skipped++; continue; }

        const action = forcedTimeoutAction(state, state.toAct);
        const result = applyAction(state, action);
        if (result.error) { skipped++; continue; } // engine rejects (state moved) — leave it

        const split = serializeAuthoritative(result.state);
        const deadline = result.state.toAct != null
          ? new Date(Date.now() + ACT_TIMEOUT_SECS * 1000).toISOString() : null;

        const { data: sub, error: subErr } = await admin.rpc("op_submit_action", {
          p_hand_id: h.hand_id,
          p_actor_user_id: seat.playerId,                 // act on behalf of the timed-out seat's owner
          p_action: actionToRow(action),
          p_new_state: split.stateJson,
          p_board_future: split.liveDeck,
          p_events: result.events.map((e) => ({ type: e.type, payload: e.payload })),
          p_expected_state_version: ctx.state_version,    // CAS: stale ⇒ race_lost ⇒ player acted in time
          p_act_deadline: deadline,
          p_idempotency_key: `timeout_${h.hand_id}_${ctx.state_version}`, // deterministic ⇒ idempotent re-run
        });
        if (subErr) { skipped++; continue; }
        if (sub?.outcome === "ok" || sub?.outcome === "duplicate") forced++;
        else if (sub?.outcome === "race_lost") raceLost++;
        else skipped++;
      } catch (_e) {
        // one hand failing must NOT abort the sweep of the others (table isolation)
        skipped++;
      }
    }

    return json({ outcome: "ok", expired: hands.length, forced, raceLost, skipped }, 200);
  } catch (_e) {
    console.error("[online-poker-timeout-sweep] unexpected error"); // G1: no internals
    return json({ error: "internal error" }, 500);
  }
});
