// Admin/Cashier confirms VND received in escrow bank for ONE purchase.
// Input: { purchase_id, bank_tx_id?, note? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  purchase_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  bank_tx_id: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
}).refine((v) => !!v.purchase_id || !!v.deal_id, {
  message: "purchase_id or deal_id required",
  path: ["purchase_id"],
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "Missing auth" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } },
    );
    const { data: userData, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userData?.user) return j({ error: "Unauthorized" }, 401);
    const uid = userData.user.id;

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

    const bankTxId = (body?.bank_tx_id ?? "").trim() || null;

    let purchaseId = body?.purchase_id;
    if (!purchaseId && body?.deal_id) {
      const { data: legacy } = await admin
        .from("staking_purchases")
        .select("id")
        .eq("deal_id", body.deal_id)
        .eq("status", "committed")
        .limit(2);
      if (!legacy || legacy.length === 0) return j({ error: "No committed purchase for deal" }, 404);
      if (legacy.length > 1) return j({ error: "Multiple committed purchases — pass purchase_id" }, 400);
      purchaseId = legacy[0].id;
    }
    if (!purchaseId) return j({ error: "purchase_id required" }, 400);

    const { data: purchase } = await admin
      .from("staking_purchases")
      .select("id, deal_id, backer_id, percent, amount_vnd, status, reference_code")
      .eq("id", purchaseId)
      .maybeSingle();
    if (!purchase) return j({ error: "Purchase not found" }, 404);
    if (purchase.status === "funded") {
      return j({ success: true, already: true, purchase_id: purchase.id, purchase_status: "funded" });
    }
    if (purchase.status !== "committed") {
      return j({ error: `Purchase status is ${purchase.status}, expected committed` }, 409);
    }

    const { data: deal } = await admin
      .from("staking_deals")
      .select("id, status, percentage_sold, filled_percent, early_closed, player_id, custom_event_name, club_id")
      .eq("id", purchase.deal_id)
      .maybeSingle();
    if (!deal) return j({ error: "Deal not found" }, 404);

    if (!isSuperAdmin && isCashier) {
      if (!deal.club_id) return j({ error: "Forbidden: deal không gắn CLB" }, 403);
      const { data: ok } = await admin.rpc("is_club_cashier", { _user_id: uid, _club_id: deal.club_id });
      if (!ok) return j({ error: "Forbidden: bạn không được gán cashier cho CLB này" }, 403);
    }

    const { error: txErr } = await admin.from("escrow_transactions").insert({
      deal_id: purchase.deal_id,
      transaction_type: "fund_lock",
      amount_vnd: purchase.amount_vnd,
      bank_tx_id: bankTxId ?? purchase.reference_code,
      performed_by_admin_id: uid,
      note: body?.note ?? `VND funded purchase ${purchase.reference_code}`,
    });
    if (txErr) return j({ error: `Ledger write failed: ${txErr.message}` }, 500);

    const { error: pErr } = await admin
      .from("staking_purchases")
      .update({
        status: "funded",
        funded_at: new Date().toISOString(),
      })
      .eq("id", purchase.id)
      .eq("status", "committed");
    if (pErr) return j({ error: pErr.message }, 500);

    const { data: rows } = await admin
      .from("staking_purchases")
      .select("status, percent")
      .eq("deal_id", deal.id)
      .limit(500);
    const live = (rows ?? []).filter((r: any) => r.status === "committed" || r.status === "funded");
    const totalCommitted = live.filter((r: any) => r.status === "committed").reduce((s, r: any) => s + Number(r.percent), 0);
    const totalFunded = live.filter((r: any) => r.status === "funded").reduce((s, r: any) => s + Number(r.percent), 0);

    let newDealStatus: string | null = null;
    if (totalCommitted === 0 && totalFunded > 0) {
      newDealStatus = "funded";
    }

    if (newDealStatus) {
      const { error: dUpd } = await admin
        .from("staking_deals")
        .update({
          status: newDealStatus,
          escrow_locked_at: new Date().toISOString(),
          filled_percent: totalFunded,
        })
        .eq("id", deal.id)
        .in("status", ["committing", "committed"]);
      if (dUpd) return j({ error: dUpd.message }, 500);
    }

    await admin.from("staking_audit_logs").insert({
      deal_id: deal.id,
      action: "admin_confirmed_funded",
      performed_by: uid,
      old_status: deal.status,
      new_status: newDealStatus ?? deal.status,
      metadata: {
        purchase_id: purchase.id,
        backer_id: purchase.backer_id,
        percent: purchase.percent,
        amount_vnd: purchase.amount_vnd,
        bank_tx_id: bankTxId,
        total_funded_percent: totalFunded,
        total_committed_percent: totalCommitted,
      },
    });

    // === IN-APP NOTIFICATIONS ===
    try {
      const pct = Number(purchase.percent);
      const vnd = Number(purchase.amount_vnd);
      const label = deal.custom_event_name ?? `Deal #${String(deal.id).slice(0, 6)}`;

      // 1. Notify backer: funding confirmed
      await admin.from("notifications").insert({
        user_id: purchase.backer_id,
        type: "deal_funded",
        title: "Đã xác nhận nạp tiền",
        body: `Khoản đầu tư ${pct}% deal "${label}" (${vnd.toLocaleString()} VND) đã được xác nhận.`,
        data: { deal_id: deal.id, purchase_id: purchase.id, percent: pct },
      });

      // 2. Notify player: someone funded
      await admin.from("notifications").insert({
        user_id: deal.player_id,
        type: "purchase_funded",
        title: "Có người hỗ trợ mới đã nạp tiền",
        body: `Backer vừa nạp ${pct}% deal "${label}". Tổng đã funded: ${totalFunded}/${deal.percentage_sold}%.`,
        data: { deal_id: deal.id, backer_id: purchase.backer_id, total_funded: totalFunded },
      });

      // 3. Notify cashiers + club owner
      if (deal.club_id) {
        const { data: cashiers } = await admin
          .from("club_cashiers")
          .select("user_id")
          .eq("club_id", deal.club_id);
        if (cashiers) {
          const cNotis = cashiers
            .filter((c: any) => c.user_id !== uid && c.user_id !== purchase.backer_id)
            .map((c: any) => ({
              user_id: c.user_id,
              type: "purchase_funded",
              title: "Giao dịch mới đã nạp tiền",
              body: `Backer đã nạp ${pct}% deal "${label}" (${vnd.toLocaleString()} VND).`,
              data: { deal_id: deal.id, club_id: deal.club_id, purchase_id: purchase.id },
            }));
          if (cNotis.length) await admin.from("notifications").insert(cNotis);
        }
        const { data: club } = await admin
          .from("clubs")
          .select("owner_id")
          .eq("id", deal.club_id)
          .maybeSingle();
        if (club?.owner_id && club.owner_id !== uid && club.owner_id !== purchase.backer_id) {
          await admin.from("notifications").insert({
            user_id: club.owner_id,
            type: "purchase_funded",
            title: "Giao dịch mới đã nạp tiền tại CLB của bạn",
            body: `Backer đã nạp ${pct}% deal "${label}".`,
            data: { deal_id: deal.id, club_id: deal.club_id },
          });
        }
      }
    } catch (_) { /* non-critical */ }

    // Best-effort emails: backer + player on every successful funding confirmation
    try {
      const { fundingConfirmedBackerEmail, fundingConfirmedPlayerEmail, sendEmailViaFunction } =
        await import("../_shared/emailTemplates.ts");

      const dealShortId = String(deal.id).slice(0, 6);
      let clubName: string | null = null;
      if (deal.club_id) {
        const { data: club } = await admin.from("clubs").select("name").eq("id", deal.club_id).maybeSingle();
        clubName = club?.name ?? null;
      }
      const tournamentName = deal.custom_event_name ?? null;
      const finalDealStatus = newDealStatus ?? deal.status;
      const statusLabel =
        finalDealStatus === "funded" ? "Đã xác nhận đầy đủ"
        : finalDealStatus === "committed" ? "Đã đủ % — đang chờ xác nhận tiền"
        : "Đang nhận hỗ trợ";

      const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
      const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // Backer email
      try {
        const { data: bu } = await admin.auth.admin.getUserById(purchase.backer_id);
        const bto = bu?.user?.email;
        if (bto) {
          const tpl = fundingConfirmedBackerEmail({
            dealShortId,
            clubName,
            tournamentName,
            amountVnd: Number(purchase.amount_vnd),
            percent: Number(purchase.percent),
          });
          await sendEmailViaFunction(SUPA_URL, SVC_KEY, { to: bto, ...tpl });
        }
      } catch (e) { console.error("email backer funding_confirmed failed", e); }

      // Player email
      try {
        const { data: pu } = await admin.auth.admin.getUserById(deal.player_id);
        const pto = pu?.user?.email;
        if (pto) {
          const tpl = fundingConfirmedPlayerEmail({
            dealShortId,
            clubName,
            tournamentName,
            amountVnd: Number(purchase.amount_vnd),
            fundedPercent: totalFunded,
            soldPercent: Number(deal.percentage_sold),
            statusLabel,
          });
          await sendEmailViaFunction(SUPA_URL, SVC_KEY, { to: pto, ...tpl });
        }
      } catch (e) { console.error("email player funding_confirmed failed", e); }
    } catch (e) { console.error("email funding_confirmed dispatch failed", e); }


    return j({
      success: true,
      purchase_id: purchase.id,
      purchase_status: "funded",
      deal_status: newDealStatus ?? deal.status,
      total_funded_percent: totalFunded,
      total_committed_percent: totalCommitted,
    });
  } catch (e: any) {
    return j({ error: e.message ?? "internal" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
