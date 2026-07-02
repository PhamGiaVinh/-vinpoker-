// Cashier/SuperAdmin refunds a staking deal: refunds all funded backers.
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
import {
  corsHeaders,
  json,
  createAdminClient,
  requireAdminRoles,
} from "../_shared/staking-common.ts";

const BodySchema = z.object({
  deal_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } },
    );
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) return json({ error: "Unauthorized" }, 401);
    const uid = u.user.id;

    const admin = createAdminClient();

    const roles = await requireAdminRoles(admin, uid);
    if (roles instanceof Response) return roles;
    const { isSuper, isCashier } = roles;

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const { deal_id, reason } = parsed.data;

    const { data: deal } = await admin
      .from("staking_deals")
      .select("id, player_id, club_id, status, custom_event_name, buy_in_amount_vnd, filled_percent")
      .eq("id", deal_id)
      .maybeSingle();
    if (!deal) return json({ error: "Deal not found" }, 404);
    if (!["funded", "locked", "result_entered", "result_verified"].includes(deal.status)) {
      return json({ error: `Deal status is ${deal.status}, cannot refund` }, 400);
    }

    // Cashier scope check. Club-less deals are super_admin-only (mirrors admin-confirm-funded) —
    // otherwise a cashier of ANY club could refund deals with no club binding.
    if (!isSuper) {
      if (!deal.club_id) return json({ error: "Forbidden: deal không gắn CLB — cần super admin" }, 403);
      const { data: ok } = await admin.rpc("is_club_cashier", { _user_id: uid, _club_id: deal.club_id });
      if (!ok) return json({ error: "Not cashier for this club" }, 403);
    }

    const label = deal.custom_event_name ?? `Deal #${String(deal.id).slice(0, 6)}`;

    // 1) Compare-and-swap the deal FIRST — the single authority switch. 0 rows = someone else got
    //    there first (concurrent refund, or a release path moved the deal on) → do NOTHING.
    //    This is the refund/release mutual-exclusion point.
    const { data: dealWon, error: dCasErr } = await admin.from("staking_deals")
      .update({
        status: "deal_refunded",
        refund_status: "completed",
        refund_reason: reason,
        refunded_by: uid,
        refunded_at: new Date().toISOString(),
      })
      .eq("id", deal.id)
      .in("status", ["funded", "locked", "result_entered", "result_verified"])
      .select("id");
    if (dCasErr) return json({ error: dCasErr.message }, 500);
    if (!dealWon || dealWon.length === 0) {
      const { data: dNow } = await admin.from("staking_deals").select("status").eq("id", deal.id).maybeSingle();
      return json({ error: `Deal is now ${dNow?.status ?? "unknown"} — refund NOT performed` }, 409);
    }

    // 2) Flip funded purchases → refunded and use the UPDATE's returned rows as the authoritative
    //    refund set (no read-then-write gap, no silent .limit() truncation). execute-release pays
    //    only status='funded' rows, so this also starves any in-flight release of payees.
    const { data: refunded, error: pErr } = await admin
      .from("staking_purchases")
      .update({ status: "refunded" })
      .eq("deal_id", deal.id)
      .eq("status", "funded")
      .select("id, backer_id, percent, amount_vnd");
    if (pErr) {
      console.error("staking-process-refund: purchase flip FAILED after deal CAS:", pErr.message);
      return json({ error: `Deal marked refunded but purchases not flipped: ${pErr.message} — needs admin attention` }, 500);
    }
    const backers = refunded ?? [];

    // 3) Ledger rows — error-checked; failures are collected and surfaced, never swallowed.
    const ledgerFailures: string[] = [];
    for (const p of backers) {
      const { error: txErr } = await admin.from("escrow_transactions").insert({
        deal_id: deal.id,
        transaction_type: "refund",
        amount_vnd: p.amount_vnd,
        performed_by_admin_id: uid,
        note: `Refund to backer ${p.backer_id} (${p.percent}%) — ${reason}`,
      });
      if (txErr) {
        ledgerFailures.push(`${p.id}: ${txErr.message}`);
        console.error(`staking-process-refund: LEDGER WRITE FAILED for purchase ${p.id}:`, txErr.message);
      }
    }

    // Audit
    const { error: auditErr } = await admin.from("staking_audit_logs").insert({
      deal_id: deal.id,
      action: "refunded",
      performed_by: uid,
      old_status: deal.status,
      new_status: "deal_refunded",
      metadata: { reason, backer_count: backers.length, ledger_failures: ledgerFailures.length },
    });
    if (auditErr) console.error("staking-process-refund: audit insert FAILED:", auditErr.message);

    // === IN-APP NOTIFICATIONS ===
    try {
      // Notify player
      await admin.from("notifications").insert({
        user_id: deal.player_id,
        type: "deal_refunded",
        title: "Deal đã được hoàn tiền",
        body: `Deal "${label}" đã bị hoàn tiền. Lý do: ${reason}`,
        data: { deal_id: deal.id, reason },
      });

      // Notify each funded backer
      for (const p of backers) {
        await admin.from("notifications").insert({
          user_id: p.backer_id,
          type: "deal_refunded",
          title: "Bạn đã được hoàn tiền",
          body: `Khoản đầu tư ${p.percent}% (${Number(p.amount_vnd).toLocaleString()} VND) deal "${label}" đã được hoàn trả. Lý do: ${reason}`,
          data: { deal_id: deal.id, refund_amount: p.amount_vnd, reason },
        });
      }

      // Notify cashiers + club owner
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
              type: "deal_refunded",
              title: "Deal đã được hoàn tiền tại CLB",
              body: `Deal "${label}" đã hoàn tiền cho ${backers.length} backer. Lý do: ${reason}`,
              data: { deal_id: deal.id, club_id: deal.club_id, reason },
            }));
          if (cNotis.length) await admin.from("notifications").insert(cNotis);
        }
      }
    } catch (_) { /* non-critical */ }

    // Emails (best-effort)
    try {
      const { sendEmailViaFunction } = await import("../_shared/emailTemplates.ts");
      const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
      const SVC_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      for (const p of backers) {
        const { data: bu } = await admin.auth.admin.getUserById(p.backer_id);
        if (bu?.user?.email) {
          await sendEmailViaFunction(SUPA_URL, SVC_KEY, {
            to: bu.user.email,
            subject: `[VBacker] Hoàn tiền deal ${label}`,
            html: `<p>Khoản đầu tư ${p.percent}% (${Number(p.amount_vnd).toLocaleString()} VND) đã được hoàn trả.</p><p>Lý do: ${reason}</p>`,
          }).catch(() => {});
        }
      }
    } catch (_) { /* non-critical */ }

    return json({
      success: true,
      refunded_backers: backers.length,
      deal_id: deal.id,
      ledger_failures: ledgerFailures.length,
      ...(ledgerFailures.length ? { warning: "một số dòng sổ quỹ ghi lỗi — cần đối chiếu thủ công", failed_purchases: ledgerFailures } : {}),
    });
  } catch (e: any) {
    return json({ error: e.message ?? "internal" }, 500);
  }
});
