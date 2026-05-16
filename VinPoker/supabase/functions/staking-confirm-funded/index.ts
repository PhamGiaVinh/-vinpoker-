// Admin confirms VND has actually arrived in escrow bank account.
// Effect: writes immutable escrow_transactions(fund_lock) row + flips deal status committed -> funded -> locked.
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
  bank_tx_id: z.string().trim().min(1).max(200),
  amount_vnd: z.number().min(1).max(1e10),
  proof_image_url: z.string().url().max(2048).nullish(),
  note: z.string().trim().max(1000).nullish(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } }
    );
    const { data: userData, error: uErr } = await supabase.auth.getUser();
    if (uErr || !userData.user) return json({ error: "Invalid token" }, 401);
    const uid = userData.user.id;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("role", "super_admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden: super_admin only" }, 403);

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const { data: deal, error: dErr } = await admin
      .from("staking_deals")
      .select("id, status, escrow_amount_vnd, backer_id")
      .eq("id", body.deal_id)
      .maybeSingle();
    if (dErr || !deal) return json({ error: "Deal not found" }, 404);
    if (deal.status !== "committed")
      return json({ error: `Deal must be 'committed' (current: ${deal.status})` }, 400);
    if (!deal.backer_id) return json({ error: "Deal has no backer" }, 400);

    if (body.amount_vnd !== Number(deal.escrow_amount_vnd)) {
      return json(
        {
          error: "Amount mismatch",
          expected: deal.escrow_amount_vnd,
          received: body.amount_vnd,
        },
        400
      );
    }

    // 1) Append-only ledger entry
    const { error: txErr } = await admin.from("escrow_transactions").insert({
      deal_id: body.deal_id,
      transaction_type: "fund_lock",
      amount_vnd: body.amount_vnd,
      bank_tx_id: body.bank_tx_id,
      proof_image_url: body.proof_image_url ?? null,
      performed_by_admin_id: uid,
      note: body.note ?? null,
    });
    if (txErr) return json({ error: `Ledger write failed: ${txErr.message}` }, 500);

    // 2) Move deal to locked (committed -> funded -> locked atomically by single update)
    const { error: updErr } = await admin
      .from("staking_deals")
      .update({ status: "locked" })
      .eq("id", body.deal_id)
      .eq("status", "committed");
    if (updErr) return json({ error: updErr.message }, 500);

    await admin.from("staking_audit_logs").insert({
      deal_id: body.deal_id,
      action: "funded",
      performed_by: uid,
      old_status: "committed",
      new_status: "locked",
      metadata: { bank_tx_id: body.bank_tx_id, amount_vnd: body.amount_vnd },
    });

    return json({ success: true, deal_id: body.deal_id, status: "locked" });
  } catch (e: any) {
    return json({ error: e.message ?? "internal" }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
