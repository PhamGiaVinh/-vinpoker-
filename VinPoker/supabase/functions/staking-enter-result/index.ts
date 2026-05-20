// PLAYER enters tournament result (prize, placement, proof_url) for own deal.
// Auth: auth.uid() === deal.player_id AND status='funded'. No admin access via this fn.
// Computes payouts via DB function (Formula A) and snapshots to result_data.
// Status: funded -> result_entered.
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
  prize_amount: z.number().int().min(0).max(1e10),
  placement: z.string().trim().min(1).max(50),
  proof_url: z.string().url().max(2048),
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

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const prize = body.prize_amount;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Authorization: must be the player AND status=funded
    const { data: deal, error: dErr } = await admin
      .from("staking_deals")
      .select("id, player_id, status, percentage_sold, filled_percent, markup, platform_percent_fee, platform_archive_fee, player_checked_in")
      .eq("id", body.deal_id)
      .maybeSingle();
    if (dErr) return json({ error: dErr.message }, 500);
    if (!deal) return json({ error: "Deal not found" }, 404);
    if (deal.player_id !== uid) return json({ error: "Forbidden — not your deal" }, 403);
    if (deal.status !== "funded") {
      return json({ error: `Deal must be funded (current: ${deal.status})` }, 400);
    }
    if (!(deal as any).player_checked_in) {
      return json({ error: "Bạn cần check-in tại CLB trước khi nhập kết quả. Vui lòng yêu cầu cashier check-in." }, 400);
    }

    // Use ACTUAL funded percent (handles partial fills / early close), not max offered
    const fundedPct = Number(deal.filled_percent ?? 0);

    // ============================================
    // FUTURE: International expansion (preserve)
    //   const percentFee = Number(deal.platform_percent_fee ?? 1.0);
    //   const platformFee = prize > 0 ? Math.floor((prize * percentFee) / 100) : 0;
    // ============================================
    // NEW: Vietnam MVP — fixed archive fee 199K, capped at prize.
    const ARCHIVE_FEE = Number((deal as any).platform_archive_fee ?? 199000);
    const platformFee = prize > 0 ? Math.min(ARCHIVE_FEE, prize) : 0;
    const distributable = Math.max(0, prize - platformFee);
    const backer = Math.round((distributable * fundedPct) / 100);
    const player = Math.max(0, distributable - backer);
    const p = { player, backer, fee: platformFee };

    const result_data = {
      prize_amount: prize,
      placement: body.placement.trim(),
      backer_payout: p.backer,
      player_keeps: p.player,
      platform_fee: p.fee,
      platform_archive_fee: ARCHIVE_FEE,
      formula: "B_fixed_archive_fee",
      computed_at: new Date().toISOString(),
    };

    const updateFields: Record<string, any> = {
      result_prize_vnd: prize,
      placement: body.placement.trim(),
      result_proof_url: body.proof_url,
      result_data,
      result_entered_at: new Date().toISOString(),
      result_entered_by: uid,
      player_payout_vnd: p.player,
      backer_payout_vnd: p.backer,
      platform_fee_vnd: p.fee,
      status: "result_entered",
    };

    // If prize is 0 (busted), auto-mark player as busted
    if (prize === 0) {
      updateFields.player_busted_out = true;
    }

    const { error: updErr } = await admin
      .from("staking_deals")
      .update(updateFields)
      .eq("id", body.deal_id)
      .eq("player_id", uid)
      .eq("status", "funded");
    if (updErr) return json({ error: updErr.message }, 500);

    await admin.from("staking_audit_logs").insert({
      deal_id: body.deal_id,
      action: "result_entered",
      performed_by: uid,
      old_status: "funded",
      new_status: "result_entered",
      metadata: { prize, placement: body.placement.trim(), payouts: p, proof_url: body.proof_url },
    });

    return json({ success: true, status: "result_entered", payouts: p });
  } catch (e: any) {
    return json({ error: e?.message ?? "internal" }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
