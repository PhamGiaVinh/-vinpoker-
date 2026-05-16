// Admin #2 cosigns. Must be a different super_admin than requester.
// Status: release_requested -> cosigned. Release request: pending_cosign -> approved.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  release_request_id: z.string().uuid(),
  note: z.string().trim().max(1000).nullish(),
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
    const { data: roleRows } = await admin
      .from("user_roles").select("role")
      .eq("user_id", uid).in("role", ["super_admin", "cashier"]);
    const roles = (roleRows ?? []).map((r: any) => r.role as string);
    if (roles.length === 0) return json({ error: "Forbidden" }, 403);
    const isSuper = roles.includes("super_admin");
    const isCashier = roles.includes("cashier");

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const { data: rr } = await admin
      .from("staking_release_requests")
      .select("id, deal_id, requested_by_admin_id, status")
      .eq("id", body.release_request_id)
      .maybeSingle();
    if (!rr) return json({ error: "Release request not found" }, 404);
    if (rr.status === "approved") {
      return json({ success: true, release_request_id: rr.id, status: "cosigned", existing: true });
    }
    if (rr.status !== "pending_cosign") return json({ error: `Already ${rr.status}` }, 400);
    if (!isSuper && isCashier) {
      const { data: dealRow } = await admin.from("staking_deals").select("club_id").eq("id", rr.deal_id).maybeSingle();
      if (!dealRow?.club_id) return json({ error: "Forbidden: deal không gắn CLB" }, 403);
      const { data: ok } = await admin.rpc("is_club_cashier", { _user_id: uid, _club_id: dealRow.club_id });
      if (!ok) return json({ error: "Forbidden: bạn không được gán cashier cho CLB này" }, 403);
    }
    // Cashier-driven flow: same actor may request + cosign (1-step). Admin flow: still requires distinct cosigner.
    if (!isCashier && rr.requested_by_admin_id === uid) {
      return json({ error: "Co-signer must be a different admin than requester" }, 403);
    }

    const { error: updErr } = await admin
      .from("staking_release_requests")
      .update({ cosigned_by_admin_id: uid, note: body.note ?? null })
      .eq("id", body.release_request_id)
      .eq("status", "pending_cosign");
    if (updErr) return json({ error: updErr.message }, 500);

    const { error: dErr } = await admin
      .from("staking_deals")
      .update({ status: "cosigned" })
      .eq("id", rr.deal_id)
      .eq("status", "release_requested");
    if (dErr) return json({ error: dErr.message }, 500);

    await admin.from("staking_audit_logs").insert({
      deal_id: rr.deal_id,
      action: "release_cosigned",
      performed_by: uid,
      old_status: "release_requested",
      new_status: "cosigned",
      metadata: { release_request_id: rr.id, requested_by: rr.requested_by_admin_id },
    });

    return json({ success: true, release_request_id: rr.id, status: "cosigned" });
  } catch (e: any) {
    return json({ error: e?.message ?? "internal" }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
