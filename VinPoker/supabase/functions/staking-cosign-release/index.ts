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

    // Compare-and-swap on the request; the DB trigger release_req_touch_trg completes the
    // transition (sets cosigned_at + status='approved'). Preserve the requester's note unless the
    // cosigner explicitly provided one. Check affected rows: 0 rows = lost a concurrent race.
    const rrUpdate: Record<string, unknown> = { cosigned_by_admin_id: uid };
    if (body.note != null && body.note !== "") rrUpdate.note = body.note;
    const { data: rrWon, error: updErr } = await admin
      .from("staking_release_requests")
      .update(rrUpdate)
      .eq("id", body.release_request_id)
      .eq("status", "pending_cosign")
      .select("id");
    if (updErr) return json({ error: updErr.message }, 500);
    if (!rrWon || rrWon.length === 0) {
      // concurrent cosign won — idempotent success if it ended approved, else surface state
      const { data: now } = await admin.from("staking_release_requests")
        .select("status").eq("id", body.release_request_id).maybeSingle();
      if (now?.status === "approved") {
        return json({ success: true, release_request_id: rr.id, status: "cosigned", existing: true });
      }
      return json({ error: `Release request is now ${now?.status ?? "unknown"} — not cosigned` }, 409);
    }

    const { data: dealWon, error: dErr } = await admin
      .from("staking_deals")
      .update({ status: "cosigned" })
      .eq("id", rr.deal_id)
      .eq("status", "release_requested")
      .select("id");
    if (dErr) return json({ error: dErr.message }, 500);
    if (!dealWon || dealWon.length === 0) {
      // Request is approved (trigger fired) but the deal was NOT in release_requested — surface
      // the inconsistency loudly instead of pretending the transition happened.
      const { data: dNow } = await admin.from("staking_deals")
        .select("status").eq("id", rr.deal_id).maybeSingle();
      if (dNow?.status === "cosigned") {
        return json({ success: true, release_request_id: rr.id, status: "cosigned", existing: true });
      }
      console.error(`cosign-release state mismatch: request ${rr.id} approved but deal ${rr.deal_id} is ${dNow?.status}`);
      const { error: mmErr } = await admin.from("staking_audit_logs").insert({
        deal_id: rr.deal_id,
        action: "release_cosign_state_mismatch",
        performed_by: uid,
        old_status: dNow?.status ?? "unknown",
        new_status: dNow?.status ?? "unknown",
        metadata: { release_request_id: rr.id, note: "request approved but deal not in release_requested" },
      });
      if (mmErr) console.error("audit insert failed:", mmErr.message);
      return json({ error: `Request approved but deal is ${dNow?.status} — needs admin attention` }, 409);
    }

    const { error: auditErr } = await admin.from("staking_audit_logs").insert({
      deal_id: rr.deal_id,
      action: "release_cosigned",
      performed_by: uid,
      old_status: "release_requested",
      new_status: "cosigned",
      metadata: { release_request_id: rr.id, requested_by: rr.requested_by_admin_id },
    });
    if (auditErr) console.error("cosign-release: audit insert FAILED:", auditErr.message);

    return json({ success: true, release_request_id: rr.id, status: "cosigned" });
  } catch (e: any) {
    return json({ error: e?.message ?? "internal" }, 500);
  }
});


