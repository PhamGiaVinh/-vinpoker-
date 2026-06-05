// Admin marks player-entered result as disputed. status: result_entered -> result_disputed.
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
  reason: z.string().trim().min(5).max(1000),
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

    const { data: deal } = await admin
      .from("staking_deals").select("id, status, player_id, custom_event_name, club_id").eq("id", body.deal_id).maybeSingle();
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
      .update({ status: "result_disputed", dispute_reason: body.reason.trim() })
      .eq("id", body.deal_id)
      .eq("status", "result_entered");
    if (updErr) return json({ error: updErr.message }, 500);

    await admin.from("staking_audit_logs").insert({
      deal_id: body.deal_id,
      action: "result_disputed",
      performed_by: uid,
      old_status: "result_entered",
      new_status: "result_disputed",
      metadata: { reason: body.reason.trim() },
    });

    try {
      const { emailResultDisputed, sendEmailViaFunction } = await import("../_shared/emailTemplates.ts");
      const { data: u } = await admin.auth.admin.getUserById(deal.player_id);
      const to = u?.user?.email;
      if (to) {
        const label = deal.custom_event_name ?? `Deal #${String(deal.id).slice(0, 6)}`;
        const tpl = emailResultDisputed({ label, deal_id: deal.id, reason: body.reason.trim() });
        await sendEmailViaFunction(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { to, ...tpl });
      }
    } catch (e) { console.error("email result_disputed failed", e); }

    return json({ success: true, status: "result_disputed" });
  } catch (e: any) {
    return json({ error: e?.message ?? "internal" }, 500);
  }
});


