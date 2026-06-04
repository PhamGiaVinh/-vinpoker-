// Admin #1 requests payout release with the verified amounts.
// Guard: status=result_verified. Server recomputes via Formula A and rejects mismatch.
// Status: result_verified -> release_requested. Creates staking_release_requests row.
// Idempotent for retry/resume: release_requested/cosigned returns the active request.
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
  backer_amount: z.number().int().min(0).max(1e10),
  player_amount: z.number().int().min(0).max(1e10),
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
    const backerAmt = body.backer_amount;
    const playerAmt = body.player_amount;

    const { data: deal } = await admin
      .from("staking_deals")
      .select("id, status, percentage_sold, filled_percent, markup, platform_percent_fee, platform_archive_fee, result_prize_vnd, result_data, override_data, backer_payout_vnd, player_payout_vnd, club_id")
      .eq("id", body.deal_id).maybeSingle();
    if (!deal) return json({ error: "Deal not found" }, 404);
    if (!isSuper && isCashier) {
      const access = await requireClubAccess(admin, uid, deal.club_id);
      if (access instanceof Response) return access;
    }

    // Idempotent retry/resume path: the cashier UI can be stale after a prior
    // partial attempt, so return the existing active request instead of failing.
    if (deal.status === "release_requested" || deal.status === "cosigned") {
      const { data: existing } = await admin
        .from("staking_release_requests")
        .select("id, status")
        .eq("deal_id", body.deal_id)
        .in("status", ["pending_cosign", "approved"])
        .maybeSingle();
      if (existing?.id) {
        return json({ success: true, release_request_id: existing.id, status: deal.status, existing });
      }
    }

    if (deal.status !== "result_verified") {
      return json({ error: `Deal must be result_verified (current: ${deal.status})` }, 400);
    }

    // Server-side recomputation guard — mirror staking-enter-result formula.
    // Fee deducted from prize first, then split by ACTUAL filled_percent.
    let expectedBacker: number;
    let expectedPlayer: number;
    if (deal.override_data && (deal.override_data as any).override_backer_amount != null) {
      expectedBacker = Number((deal.override_data as any).override_backer_amount);
      expectedPlayer = Number((deal.override_data as any).override_player_amount);
    } else {
      const prize = Number(deal.result_prize_vnd ?? 0);
      const fundedPct = Number(deal.filled_percent ?? 0);
      // ============================================
      // FUTURE: International expansion (preserve)
      //   const percentFee = Number(deal.platform_percent_fee ?? 1.0);
      //   const platformFee = prize > 0 ? Math.floor((prize * percentFee) / 100) : 0;
      // ============================================
      const ARCHIVE_FEE = Number((deal as any).platform_archive_fee ?? 199000);
      const platformFee = prize > 0 ? Math.min(ARCHIVE_FEE, prize) : 0;
      const distributable = Math.max(0, prize - platformFee);
      expectedBacker = Math.round((distributable * fundedPct) / 100);
      expectedPlayer = Math.max(0, distributable - expectedBacker);
    }

    if (backerAmt !== expectedBacker || playerAmt !== expectedPlayer) {
      return json({
        error: "Amount mismatch with computed payouts. Use exact values or admin-override first.",
        expected: { backer: expectedBacker, player: expectedPlayer },
        received: { backer: backerAmt, player: playerAmt },
      }, 400);
    }

    // Block duplicate active requests
    const { data: existing } = await admin
      .from("staking_release_requests")
      .select("id, status")
      .eq("deal_id", body.deal_id)
      .in("status", ["pending_cosign", "approved"])
      .maybeSingle();
    if (existing) return json({ error: "Active release request already exists", existing }, 409);

    const { data: rr, error: rErr } = await admin
      .from("staking_release_requests")
      .insert({
        deal_id: body.deal_id,
        requested_by_admin_id: uid,
        status: "pending_cosign",
        note: body.note ?? null,
      })
      .select("id")
      .single();
    if (rErr) return json({ error: rErr.message }, 500);

    const { error: dErr } = await admin
      .from("staking_deals")
      .update({ status: "release_requested" })
      .eq("id", body.deal_id)
      .eq("status", "result_verified");
    if (dErr) return json({ error: dErr.message }, 500);

    await admin.from("staking_audit_logs").insert({
      deal_id: body.deal_id,
      action: "release_requested",
      performed_by: uid,
      old_status: "result_verified",
      new_status: "release_requested",
      metadata: { release_request_id: rr.id, backer_amount: backerAmt, player_amount: playerAmt },
    });

    return json({ success: true, release_request_id: rr.id, status: "release_requested" });
  } catch (e: any) {
    return json({ error: e?.message ?? "internal" }, 500);
  }
});


