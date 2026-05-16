// Admin manually cancels a deal in committed/listing → revert to listing, free backer slot.
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
  reason: z.string().trim().max(1000).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "Missing auth" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: cErr } = await supabase.auth.getClaims(token);
    if (cErr || !claims?.claims) return j({ error: "Unauthorized" }, 401);
    const uid = claims.claims.sub as string;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { global: { fetch: retryFetch } });
    const { data: roles } = await admin
      .from("user_roles").select("role").eq("user_id", uid).in("role", ["super_admin", "cashier"]);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    const isSuperAdmin = roleSet.has("super_admin");
    const isCashier = roleSet.has("cashier");
    if (!isSuperAdmin && !isCashier) return j({ error: "Forbidden: admin or cashier only" }, 403);

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const reason = (body.reason ?? "").trim() || "admin_manual_cancel";

    const { data: deal } = await admin.from("staking_deals")
      .select("id, status, backer_id, club_id").eq("id", body.deal_id).maybeSingle();
    if (!deal) return j({ error: "Deal not found" }, 404);
    if (!["committed", "listing"].includes(deal.status)) {
      return j({ error: `Cannot cancel deal in status ${deal.status}` }, 409);
    }

    // Cashier scope: chỉ thao tác trên deal thuộc CLB họ sở hữu
    if (!isSuperAdmin && isCashier) {
      if (!deal.club_id) return j({ error: "Forbidden: deal không gắn CLB" }, 403);
      const { data: ok } = await admin.rpc("is_club_cashier", { _user_id: uid, _club_id: deal.club_id });
      if (!ok) return j({ error: "Forbidden: bạn không được gán cashier cho CLB này" }, 403);
    }

    const oldStatus = deal.status;
    const { error: updErr } = await admin.from("staking_deals").update({
      status: "listing",
      backer_id: null,
      committed_at: null,
      transfer_proof_submitted: false,
      transfer_proof_image_url: null,
      cancellation_reason: reason,
    }).eq("id", body.deal_id);
    if (updErr) return j({ error: updErr.message }, 500);

    await admin.from("staking_audit_logs").insert({
      deal_id: body.deal_id,
      action: "admin_cancelled_deal",
      performed_by: uid,
      old_status: oldStatus,
      new_status: "listing",
      metadata: { reason, released_backer_id: deal.backer_id },
    });

    return j({ success: true, new_status: "listing" });
  } catch (e: any) {
    return j({ error: e.message ?? "internal" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
