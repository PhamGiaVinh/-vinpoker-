// Admin verifies player-entered result. status: result_entered -> result_verified.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parseBody, z } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({ deal_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
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

    const { data: deal } = await admin
      .from("staking_deals").select("id, status, club_id").eq("id", body.deal_id).maybeSingle();
    if (!deal) return json({ error: "Deal not found" }, 404);
    if (deal.status !== "result_entered") {
      return json({ error: `Deal must be result_entered (current: ${deal.status})` }, 400);
    }
    if (!isSuper && isCashier) {
      if (!deal.club_id) return json({ error: "Forbidden: deal không gắn CLB" }, 403);
      const { data: ok } = await admin.rpc("is_club_cashier", { _user_id: uid, _club_id: deal.club_id });
      if (!ok) return json({ error: "Forbidden: bạn không được gán cashier cho CLB này" }, 403);
    }

    const { error: updErr } = await admin
      .from("staking_deals")
      .update({
        status: "result_verified",
        result_verified_at: new Date().toISOString(),
        result_verified_by: uid,
      })
      .eq("id", body.deal_id)
      .eq("status", "result_entered");
    if (updErr) return json({ error: updErr.message }, 500);

    await admin.from("staking_audit_logs").insert({
      deal_id: body.deal_id,
      action: "result_verified",
      performed_by: uid,
      old_status: "result_entered",
      new_status: "result_verified",
    });

    return json({ success: true, status: "result_verified" });
  } catch (e: any) {
    return json({ error: e?.message ?? "internal" }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
