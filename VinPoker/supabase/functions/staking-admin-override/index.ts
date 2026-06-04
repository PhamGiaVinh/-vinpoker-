// Admin overrides a disputed result. status: result_disputed -> result_verified.
// Stores override_data JSONB with reason + amounts. Updates deal payouts to override values.
// Then normal request -> cosign -> execute pipeline must follow.
import { parseBody, z } from "../_shared/validate.ts";
import {
  corsHeaders,
  json,
  createAdminClient,
  authenticateUser,
  requireAdminRoles,
  requireClubAccess,
} from "../_shared/staking-common.ts";

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
    const auth = await authenticateUser(req);
    if (auth instanceof Response) return auth;
    const uid = auth.uid;

    const admin = createAdminClient();

    const roles = await requireAdminRoles(admin, uid);
    if (roles instanceof Response) return roles;
    const { isSuper, isCashier } = roles;

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
      const access = await requireClubAccess(admin, uid, deal.club_id);
      if (access instanceof Response) return access;
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


