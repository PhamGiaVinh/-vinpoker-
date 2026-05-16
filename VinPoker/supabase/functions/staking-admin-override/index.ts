// Admin overrides a disputed result. status: result_disputed -> result_verified.
// Stores override_data JSONB with reason + amounts. Updates deal payouts to override values.
// Then normal request -> cosign -> execute pipeline must follow.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  deal_id: z.string().uuid(),
  override_prize: z.number().int().min(0).max(1e10).nullish(),
  override_backer_amount: z.number().int().min(0).max(1e10),
  override_player_amount: z.number().int().min(0).max(1e10),
  override_reason: z.string().trim().min(20).max(2000),
  new_proof_url: z.string().url().max(2048).nullish(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } }
    );
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Invalid token" }, 401);
    const uid = userData.user.id;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: roles } = await admin
      .from("user_roles").select("role")
      .eq("user_id", uid).in("role", ["super_admin", "cashier"]);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    const isSuper = roleSet.has("super_admin");
    const isCashier = roleSet.has("cashier");
    if (!isSuper && !isCashier) return json({ error: "Forbidden" }, 403);

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const backerAmt = body.override_backer_amount;
    const playerAmt = body.override_player_amount;

    const { data: deal } = await admin
      .from("staking_deals")
      .select("id, status, result_prize_vnd, result_proof_url, club_id")
      .eq("id", body.deal_id)
      .maybeSingle();
    if (!deal) return json({ error: "Deal not found" }, 404);
    if (deal.status !== "result_disputed") {
      return json({ error: `Deal must be result_disputed (current: ${deal.status})` }, 400);
    }
    if (!isSuper && isCashier) {
      if (!deal.club_id) return json({ error: "Forbidden: deal không gắn CLB" }, 403);
      const { data: ok } = await admin.rpc("is_club_cashier", { _user_id: uid, _club_id: deal.club_id });
      if (!ok) return json({ error: "Forbidden: bạn không được gán cashier cho CLB này" }, 403);
    }

    const overridePrize = body.override_prize != null ? Math.floor(body.override_prize) : null;
    const override_data = {
      original_prize: deal.result_prize_vnd,
      override_prize: overridePrize,
      override_backer_amount: backerAmt,
      override_player_amount: playerAmt,
      override_fee: 0,
      reason: body.override_reason.trim(),
      overridden_by: uid,
      overridden_at: new Date().toISOString(),
      new_proof_url: body.new_proof_url ?? null,
    };

    const { error: updErr } = await admin
      .from("staking_deals")
      .update({
        override_data,
        status: "result_verified",
        result_verified_at: new Date().toISOString(),
        result_verified_by: uid,
        backer_payout_vnd: backerAmt,
        player_payout_vnd: playerAmt,
        platform_fee_vnd: 0,
        ...(overridePrize != null ? { result_prize_vnd: overridePrize } : {}),
        ...(body.new_proof_url ? { result_proof_url: body.new_proof_url } : {}),
      })
      .eq("id", body.deal_id)
      .eq("status", "result_disputed");
    if (updErr) return json({ error: updErr.message }, 500);

    await admin.from("staking_audit_logs").insert({
      deal_id: body.deal_id,
      action: "admin_override_applied",
      performed_by: uid,
      old_status: "result_disputed",
      new_status: "result_verified",
      metadata: override_data,
    });

    return json({ success: true, status: "result_verified", override_data });
  } catch (e: any) {
    return json({ error: e?.message ?? "internal" }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
