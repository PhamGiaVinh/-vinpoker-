// Final step: writes immutable ledger and flips deal -> completed.
// SPLIT PAYOUT MODEL (VND):
//   - Player is paid in CASH at the club (admin checks "player_paid").
//   - Each Backer is paid via bank_transfer or cash (VND), admin confirms checkbox.
//   - Optional proof_url image upload per backer.
import { parseBody, z } from "../_shared/validate.ts";
import {
  corsHeaders,
  json,
  createAdminClient,
  authenticateUser,
  requireAdminRoles,
  requireClubAccess,
} from "../_shared/staking-common.ts";

const BackerPayoutSchema = z.object({
  purchase_id: z.string().uuid(),
  payout_method: z.enum(["bank_transfer", "cash"]),
  proof_url: z.string().url().max(2048).nullish(),
  paid: z.literal(true, { errorMap: () => ({ message: "Phải xác nhận đã trả cho mọi Backer" }) }),
});

const BodySchema = z.object({
  release_request_id: z.string().uuid(),
  player_paid: z.literal(true, { errorMap: () => ({ message: "Phải xác nhận đã trả Player tiền mặt." }) }),
  backer_payouts: z.array(BackerPayoutSchema).min(1).max(100),
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
      .select("id, deal_id, status, requested_by_admin_id, cosigned_by_admin_id, executed_at")
      .eq("id", body.release_request_id)
      .maybeSingle();
    if (!rr) return json({ error: "Release request not found" }, 404);
    if (rr.executed_at) return json({ error: "Already executed" }, 409);
    if (rr.status !== "approved") return json({ error: `Release request status=${rr.status}` }, 400);
    if (!rr.cosigned_by_admin_id) return json({ error: "Missing co-signer" }, 400);

    const { data: deal } = await admin
      .from("staking_deals")
      .select("id, status, player_id, backer_id, percentage_sold, filled_percent, markup, platform_percent_fee, platform_archive_fee, result_prize_vnd, result_data, override_data, player_payout_vnd, backer_payout_vnd, platform_fee_vnd, custom_event_name, custom_event_date, custom_event_venue, buy_in_amount_vnd, placement, result_proof_url, club_id")
      .eq("id", rr.deal_id)
      .maybeSingle();
    if (!deal) return json({ error: "Deal not found" }, 404);
    if (deal.status !== "cosigned") {
      return json({ error: `Deal must be cosigned (current: ${deal.status})` }, 400);
    }
    if (!isSuper && isCashier) {
      const access = await requireClubAccess(admin, uid, deal.club_id);
      if (access instanceof Response) return access;
    }

    const { data: purchases, error: pqErr } = await admin
      .from("staking_purchases")
      .select("id, backer_id, percent, status")
      .eq("deal_id", rr.deal_id)
      .eq("status", "funded")
      .limit(500);
    if (pqErr) return json({ error: pqErr.message }, 500);

    const fundedSet = new Map<string, { id: string; backer_id: string; percent: number }>();
    for (const r of (purchases ?? []) as any[]) {
      fundedSet.set(r.id, { id: r.id, backer_id: r.backer_id, percent: Number(r.percent) });
    }
    const inputIds = new Set(body.backer_payouts.map((b) => b.purchase_id));
    for (const id of fundedSet.keys()) {
      if (!inputIds.has(id)) return json({ error: `Thiếu xác nhận trả tiền cho purchase ${id}` }, 400);
    }
    for (const id of inputIds) {
      if (!fundedSet.has(id)) return json({ error: `Purchase ${id} không thuộc deal này` }, 400);
    }

    const prize = Number(deal.result_prize_vnd ?? 0);
    const fundedPct = Number((deal as any).filled_percent ?? 0);
    // ============================================
    // FUTURE: International expansion (preserve)
    //   const percentFee = Number((deal as any).platform_percent_fee ?? 1.0);
    //   const platformFee = prize > 0 ? Math.floor((prize * percentFee) / 100) : 0;
    // ============================================
    // NEW: Vietnam MVP — fixed archive fee 199K, capped at prize.
    const ARCHIVE_FEE = Number((deal as any).platform_archive_fee ?? 199000);
    const platformFee = prize > 0 ? Math.min(ARCHIVE_FEE, prize) : 0;
    const distributable = Math.max(0, prize - platformFee);

    const perBacker = body.backer_payouts.map((bp) => {
      const fp = fundedSet.get(bp.purchase_id)!;
      return {
        purchase_id: bp.purchase_id,
        backer_id: fp.backer_id,
        percent: fp.percent,
        amount_vnd: 0, // computed below from distributable
        payout_method: bp.payout_method,
        proof_url: bp.proof_url ? String(bp.proof_url).trim() : null,
      };
    });

    let expectedBackerAgg: number;
    let expectedPlayer: number;
    if (deal.override_data && (deal.override_data as any).override_backer_amount != null) {
      expectedBackerAgg = Number((deal.override_data as any).override_backer_amount);
      expectedPlayer = Number((deal.override_data as any).override_player_amount);
    } else {
      // Match staking-enter-result formula: distributable split by ACTUAL filled_percent
      expectedBackerAgg = Math.round((distributable * fundedPct) / 100);
      expectedPlayer = Math.max(0, distributable - expectedBackerAgg);
    }

    // Per-purchase share allocated proportionally from expectedBackerAgg
    const totalPctAll = perBacker.reduce((s, r) => s + r.percent, 0) || 1;
    {
      let allocated = 0;
      for (let i = 0; i < perBacker.length - 1; i++) {
        const share = Math.round((expectedBackerAgg * perBacker[i].percent) / totalPctAll);
        perBacker[i].amount_vnd = share;
        allocated += share;
      }
      if (perBacker.length > 0) {
        perBacker[perBacker.length - 1].amount_vnd = Math.max(0, expectedBackerAgg - allocated);
      }
    }
    const sumBackerVnd = perBacker.reduce((s, r) => s + r.amount_vnd, 0);

    const dealBacker = Number(deal.backer_payout_vnd ?? -1);
    const dealPlayer = Number(deal.player_payout_vnd ?? -1);
    if (dealBacker !== expectedBackerAgg || dealPlayer !== expectedPlayer) {
      return json({
        error: "Amount mismatch detected. Possible tampering.",
        expected: { backer: expectedBackerAgg, player: expectedPlayer },
        on_deal: { backer: dealBacker, player: dealPlayer },
      }, 409);
    }
    const expectedFee = platformFee;

    const ledgerRows: Array<Record<string, unknown>> = perBacker.map((b) => ({
      deal_id: rr.deal_id,
      release_request_id: rr.id,
      entry_type: "escrow_out_backer",
      amount_vnd: b.amount_vnd,
      user_id: b.backer_id,
      performed_by: uid,
      payout_method: b.payout_method,
      proof_url: b.proof_url,
      metadata: {
        purchase_id: b.purchase_id,
        percent: b.percent,
        cosigner: rr.cosigned_by_admin_id,
        requester: rr.requested_by_admin_id,
        note: body.note ?? null,
        prize_vnd: prize,
      },
    }));
    ledgerRows.push({
      deal_id: rr.deal_id,
      release_request_id: rr.id,
      entry_type: "escrow_out_player",
      amount_vnd: expectedPlayer,
      user_id: deal.player_id,
      performed_by: uid,
      payout_method: "cash",
      proof_url: null,
      metadata: {
        cosigner: rr.cosigned_by_admin_id,
        requester: rr.requested_by_admin_id,
        note: body.note ?? null,
        kept_percent: 100 - fundedPct,
        paid_in_cash_at_club: true,
      },
    });

    const { error: ledErr } = await admin.from("staking_ledger").insert(ledgerRows);
    if (ledErr) return json({ error: `Ledger write failed: ${ledErr.message}` }, 500);

    // Mirror to payout_recipients checklist (idempotent: delete prior rows for this deal first)
    try {
      await admin.from("payout_recipients").delete().eq("deal_id", rr.deal_id);
      const recipientRows: Array<{
        deal_id: string;
        user_id: string;
        role: string;
        purchase_id: string | null;
        amount_vnd: number;
        platform_fee_vnd: number;
        method: string;
        status: string;
        proof_image_url: string | null;
        paid_at: string;
      }> = perBacker.map((b) => ({
        deal_id: rr.deal_id,
        user_id: b.backer_id,
        role: "backer" as const,
        purchase_id: b.purchase_id,
        amount_vnd: b.amount_vnd,
        platform_fee_vnd: 0,
        method: b.payout_method,
        status: "paid",
        proof_image_url: b.proof_url,
        paid_at: new Date().toISOString(),
      }));
      recipientRows.push({
        deal_id: rr.deal_id,
        user_id: deal.player_id,
        role: "player" as const,
        purchase_id: null as any,
        amount_vnd: expectedPlayer,
        platform_fee_vnd: Number((deal as any).platform_fee_vnd ?? 0),
        method: "cash",
        status: "paid",
        proof_image_url: null,
        paid_at: new Date().toISOString(),
      });
      await admin.from("payout_recipients").insert(recipientRows);
    } catch (e) {
      console.error("payout_recipients mirror failed", e);
    }

    const nowIso = new Date().toISOString();
    const { error: rrErr } = await admin
      .from("staking_release_requests")
      .update({ status: "executed", executed_at: nowIso })
      .eq("id", rr.id)
      .is("executed_at", null);
    if (rrErr) return json({ error: rrErr.message }, 500);

    const { error: dErr } = await admin
      .from("staking_deals")
      .update({ status: "completed", completed_at: nowIso })
      .eq("id", rr.deal_id)
      .eq("status", "cosigned");
    if (dErr) return json({ error: dErr.message }, 500);

    await admin.from("staking_audit_logs").insert({
      deal_id: rr.deal_id,
      action: "payout_executed",
      performed_by: uid,
      old_status: "cosigned",
      new_status: "completed",
      metadata: {
        release_request_id: rr.id,
        requester: rr.requested_by_admin_id,
        cosigner: rr.cosigned_by_admin_id,
        amounts: { backer: expectedBackerAgg, player: expectedPlayer, fee: expectedFee },
        backer_payouts: perBacker.map((b) => ({
          purchase_id: b.purchase_id, amount_vnd: b.amount_vnd, payout_method: b.payout_method,
        })),
      },
    });

    // Auto-publish to verified leaderboard (player_results) — cashier-confirmed deal counts as a verified result
    try {
      const evDate = (deal as any).custom_event_date
        ? new Date((deal as any).custom_event_date).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const tournamentName = (deal as any).custom_event_name ?? `Deal #${String(deal.id).slice(0, 6)}`;
      const buyIn = Number((deal as any).buy_in_amount_vnd ?? 0);
      const placementStr = String((deal as any).placement ?? "");
      const posMatch = placementStr.match(/\d+/);
      const position = posMatch ? parseInt(posMatch[0], 10) : null;
      const dealTag = `[deal:${deal.id}]`;
      const { data: existing } = await admin
        .from("player_results")
        .select("id")
        .eq("player_id", deal.player_id)
        .ilike("venue", `%${dealTag}%`)
        .maybeSingle();
      if (!existing) {
        await admin.from("player_results").insert({
          player_id: deal.player_id,
          tournament_name: tournamentName,
          event_date: evDate,
          buy_in: buyIn,
          prize: prize,
          position,
          venue: `${(deal as any).custom_event_venue ?? ""} ${dealTag}`.trim(),
          proof_url: (deal as any).result_proof_url ?? null,
          verified_by_admin: true,
        });
      }
    } catch (e) {
      console.error("auto player_results insert failed", e);
    }

    try {
      const { emailPayoutExecuted, sendEmailViaFunction } = await import("../_shared/emailTemplates.ts");
      const supaUrl = Deno.env.get("SUPABASE_URL")!;
      const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const label = (deal as any).custom_event_name ?? `Deal #${String(deal.id).slice(0, 6)}`;
      try {
        const { data: pu } = await admin.auth.admin.getUserById(deal.player_id);
        const to = pu?.user?.email;
        if (to) {
          const tpl = emailPayoutExecuted({ label, deal_id: deal.id, amount_vnd: expectedPlayer, role: "player" });
          await sendEmailViaFunction(supaUrl, svc, { to, ...tpl });
        }
      } catch (e) { console.error("email player failed", e); }
      for (const b of perBacker) {
        try {
          const { data: bu } = await admin.auth.admin.getUserById(b.backer_id);
          const to = bu?.user?.email;
          if (!to) continue;
          const tpl = emailPayoutExecuted({ label, deal_id: deal.id, amount_vnd: b.amount_vnd, role: "backer" });
          await sendEmailViaFunction(supaUrl, svc, { to, ...tpl });
        } catch (e) { console.error("email backer failed", e); }
      }
    } catch (e) { console.error("email payout_executed failed", e); }

    return json({
      success: true,
      status: "completed",
      amounts: { backer: expectedBackerAgg, player: expectedPlayer, fee: expectedFee },
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "internal" }, 500);
  }
});


