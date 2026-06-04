// Admin #2 cosigns. Must be a different super_admin than requester.
// Status: release_requested -> cosigned. Release request: pending_cosign -> approved.
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
  release_request_id: z.string().uuid(),
  note: z.string().trim().max(1000).nullish(),
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
      const access = await requireClubAccess(admin, uid, dealRow?.club_id ?? null);
      if (access instanceof Response) return access;
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


