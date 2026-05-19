// Phase 6 multi-backer (VND bank transfer): a Backer commits to buy `percent` of a deal.
// Returns escrow bank info; Backer must transfer VND within 30 minutes.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  deal_id: z.string().uuid(),
  percent: z.number().int().min(1).max(100),
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
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: cErr } = await userClient.auth.getClaims(token);
    if (cErr || !claimsData?.claims?.sub) {
      return j({ error: "Invalid token", details: cErr?.message }, 401);
    }
    const uid = claimsData.claims.sub as string;

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const { deal_id, percent } = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { fetch: retryFetch } },
    );

    // Backer must have a bank account so they can receive payouts later
    const { data: prof } = await admin
      .from("profiles")
      .select("bank_account_number, bank_name, bank_account_holder")
      .eq("user_id", uid)
      .maybeSingle();
    if (!prof?.bank_account_number || !prof?.bank_name || !prof?.bank_account_holder) {
      return j({
        error: "Vui lòng thêm tài khoản ngân hàng (Ngân hàng / Số TK / Chủ TK) trong Profile trước khi mua cổ phần.",
        code: "MISSING_BANK_ACCOUNT",
      }, 400);
    }

    const { data: deal, error: dErr } = await admin
      .from("staking_deals")
      .select("id, player_id, status, admin_review_status, percentage_sold, filled_percent, min_purchase_percent, buy_in_amount_vnd, markup, early_closed, custom_event_name, registration_deadline, club_id")
      .eq("id", deal_id)
      .maybeSingle();
    if (dErr || !deal) return j({ error: "Deal not found" }, 404);

    // Active escrow bank account: prefer the deal's club account, fallback to platform-wide (club_id NULL)
    let bank: any = null;
    if (deal.club_id) {
      const { data: clubBank } = await admin
        .from("platform_bank_accounts")
        .select("id, bank_name, account_number, account_holder, qr_code_url")
        .eq("account_type", "escrow")
        .eq("is_active", true)
        .eq("club_id", deal.club_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      bank = clubBank;
    }
    if (!bank) {
      const { data: fallback, error: bErr } = await admin
        .from("platform_bank_accounts")
        .select("id, bank_name, account_number, account_holder, qr_code_url")
        .eq("account_type", "escrow")
        .eq("is_active", true)
        .is("club_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (bErr) return j({ error: bErr.message }, 500);
      bank = fallback;
    }
    if (!bank) {
      return j({ error: "Admin chưa cấu hình tài khoản nhận tiền escrow.", code: "NO_ESCROW_BANK" }, 400);
    }

    if (deal.player_id === uid) return j({ error: "Cannot back your own deal" }, 400);
    if (deal.admin_review_status !== "approved") return j({ error: "Deal not approved by admin" }, 400);
    if (deal.early_closed) return j({ error: "Deal closed for new commitments" }, 409);
    if (deal.registration_deadline && new Date(deal.registration_deadline as string).getTime() < Date.now()) {
      return j({ error: "Deal đã đóng đăng ký." }, 400);
    }
    if (!["listing", "committing"].includes(String(deal.status))) {
      return j({ error: `Deal not open (status=${deal.status})` }, 409);
    }

    const { data: rows } = await admin
      .from("staking_purchases")
      .select("percent, status")
      .eq("deal_id", deal.id)
      .limit(500);
    const liveFilled = (rows ?? [])
      .filter((r: any) => r.status === "committed" || r.status === "funded")
      .reduce((s: number, r: any) => s + Number(r.percent || 0), 0);

    const remainingPct = deal.percentage_sold - liveFilled;
    const minP = deal.min_purchase_percent ?? 5;
    if (percent < minP && percent !== remainingPct) {
      return j({ error: `Tối thiểu ${minP}% (hoặc mua đúng ${remainingPct}% còn lại)` }, 400);
    }
    if (liveFilled + percent > deal.percentage_sold) {
      return j({ error: `Chỉ còn ${remainingPct}% có thể mua` }, 409);
    }

    const amountVnd = Math.round(
      (Number(deal.buy_in_amount_vnd) * percent) / 100 * Number(deal.markup),
    );

    const refCode = "VIN" +
      String(deal.id).replace(/-/g, "").slice(0, 6).toUpperCase() +
      "-" +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    const { data: ins, error: insErr } = await admin
      .from("staking_purchases")
      .insert({
        deal_id: deal.id,
        backer_id: uid,
        percent,
        markup: deal.markup,
        amount_vnd: amountVnd,
        reference_code: refCode,
        status: "committed",
      })
      .select("id, reference_code, amount_vnd")
      .single();
    if (insErr) return j({ error: insErr.message }, 500);

    const newFilled = liveFilled + percent;
    const nextStatus = newFilled >= deal.percentage_sold ? "committed" : "committing";
    const { error: upErr } = await admin
      .from("staking_deals")
      .update({ filled_percent: newFilled, status: nextStatus })
      .eq("id", deal.id);
    if (upErr) {
      await admin.from("staking_purchases").delete().eq("id", ins.id);
      return j({ error: upErr.message }, 500);
    }

    await admin.from("staking_audit_logs").insert({
      deal_id: deal.id,
      action: "committed",
      performed_by: uid,
      old_status: deal.status,
      new_status: nextStatus,
      metadata: {
        purchase_id: ins.id,
        percent,
        amount_vnd: amountVnd,
        reference_code: ins.reference_code,
        filled_percent: newFilled,
      },
    });

    await admin.from("notifications").insert({
      user_id: deal.player_id,
      type: "deal_committed",
      title: "Có Backer mới cam kết",
      body: `Backer vừa mua ${percent}% deal "${deal.custom_event_name ?? "Deal"}". Đã bán ${newFilled}/${deal.percentage_sold}%.`,
      data: { deal_id: deal.id, percent, filled_percent: newFilled },
    });

    // === Notify cashiers + club owner ===
    try {
      if (deal.club_id) {
        const { data: cashiers } = await admin
          .from("club_cashiers")
          .select("user_id")
          .eq("club_id", deal.club_id);
        if (cashiers) {
          const cNotis = cashiers
            .filter((c: any) => c.user_id !== uid)
            .map((c: any) => ({
              user_id: c.user_id,
              type: "deal_committed",
              title: "Có cam kết mới chờ xác nhận nạp tiền",
              body: `Backer vừa mua ${percent}% deal "${deal.custom_event_name ?? "Deal"}". Số tiền: ${amountVnd.toLocaleString()} VND.`,
              data: { deal_id: deal.id, club_id: deal.club_id, percent, amount_vnd: amountVnd },
            }));
          if (cNotis.length) await admin.from("notifications").insert(cNotis);
        }
        const { data: club } = await admin
          .from("clubs")
          .select("owner_id")
          .eq("id", deal.club_id)
          .maybeSingle();
        if (club?.owner_id) {
          await admin.from("notifications").insert({
            user_id: club.owner_id,
            type: "deal_committed",
            title: "Có cam kết mới tại CLB của bạn",
            body: `Backer vừa mua ${percent}% deal "${deal.custom_event_name ?? "Deal"}".`,
            data: { deal_id: deal.id, club_id: deal.club_id, percent },
          });
        }
      }
    } catch (_) { /* non-critical */ }

    return j({
      success: true,
      purchase_id: ins.id,
      reference_code: ins.reference_code,
      amount_vnd: amountVnd,
      bank_name: bank.bank_name,
      account_number: bank.account_number,
      account_holder: bank.account_holder,
      qr_code_url: bank.qr_code_url,
      deal_status: nextStatus,
      filled_percent: newFilled,
    });
  } catch (e: any) {
    return j({ error: e?.message ?? "internal" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
