// Admin verifies player-entered result. status: result_entered -> result_verified.
import { parseBody, z } from "../_shared/validate.ts";
import {
  corsHeaders,
  json,
  createAdminClient,
  authenticateUser,
  requireAdminRoles,
  requireClubAccess,
} from "../_shared/staking-common.ts";

const BodySchema = z.object({ deal_id: z.string().uuid() });

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

    const { data: deal } = await admin
      .from("staking_deals").select("id, status, club_id").eq("id", body.deal_id).maybeSingle();
    if (!deal) return json({ error: "Deal not found" }, 404);
    if (deal.status !== "result_entered") {
      return json({ error: `Deal must be result_entered (current: ${deal.status})` }, 400);
    }
    if (!isSuper && isCashier) {
      const access = await requireClubAccess(admin, uid, deal.club_id);
      if (access instanceof Response) return access;
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


