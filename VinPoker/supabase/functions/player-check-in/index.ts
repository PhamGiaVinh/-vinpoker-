// Cashier / super_admin check Player in at the club.
// - Marks deal.player_checked_in = true + player_checkin_at = now()
// - Sets early_closed = true so no more backers can commit
// - Notifies all funded/committed backers of the deal
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({ deal_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return j({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const supaUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } }
    );
    const { data: claims, error: claimsErr } = await supaUser.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return j({ error: "Unauthorized" }, 401);
    const callerId = claims.claims.sub as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role as string));
    const isSuper = roleSet.has("super_admin");
    const isCashier = roleSet.has("cashier");
    if (!isSuper && !isCashier) return j({ error: "Forbidden" }, 403);

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const dealId = parsed.data.deal_id.toLowerCase();

    const { data: deal, error: dErr } = await admin
      .from("staking_deals")
      .select("id, status, player_id, player_checked_in, club_id, custom_event_name, buy_in_amount_vnd, platform_fixed_fee, filled_percent, markup")
      .eq("id", dealId)
      .maybeSingle();
    if (dErr) return j({ error: dErr.message }, 500);
    if (!deal) return j({ error: "Deal không tồn tại" }, 404);
    if (deal.status !== "funded") return j({ error: `Deal phải ở trạng thái funded (hiện tại: ${deal.status})` }, 400);
    if (deal.player_checked_in) return j({ error: "Deal đã check-in trước đó" }, 400);

    // Cashier scope: only assigned clubs
    if (!isSuper) {
      if (!deal.club_id) return j({ error: "Deal chưa gắn CLB" }, 403);
      const { data: ok } = await admin.rpc("is_club_cashier", { _user_id: callerId, _club_id: deal.club_id });
      if (!ok) return j({ error: "Bạn không được gán cashier cho CLB này" }, 403);
    }

    const nowIso = new Date().toISOString();
    const { error: uErr } = await admin
      .from("staking_deals")
      .update({
        player_checked_in: true,
        player_checkin_at: nowIso,
        early_closed: true,
        early_closed_at: nowIso,
      })
      .eq("id", dealId);
    if (uErr) return j({ error: uErr.message }, 500);

    // Player display name for body
    const { data: playerProfile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", deal.player_id)
      .maybeSingle();
    const playerName = playerProfile?.display_name ?? "Player";
    const label = deal.custom_event_name ?? `Deal #${String(deal.id).slice(0, 6)}`;

    // Backers
    const { data: backers } = await admin
      .from("staking_purchases")
      .select("backer_id")
      .eq("deal_id", dealId)
      .in("status", ["committed", "funded"])
      .limit(500);
    const backerIds = Array.from(new Set((backers ?? []).map((b: any) => b.backer_id))).filter(Boolean);

    if (backerIds.length > 0) {
      const rows = backerIds.map((uid) => ({
        user_id: uid,
        type: "player_checked_in",
        title: "Player đã check-in tại CLB",
        body: `${playerName} đã thanh toán phần còn thiếu và sẵn sàng thi đấu deal "${label}".`,
        data: { deal_id: dealId, label, kind: "player_checked_in" },
      }));
      await admin.from("notifications").insert(rows);
    }

    // === Notify cashiers + club owner ===
    try {
      if (deal.club_id) {
        const { data: cashiers } = await admin
          .from("club_cashiers")
          .select("user_id")
          .eq("club_id", deal.club_id);
        if (cashiers) {
          const cNotis = cashiers
            .filter((c: any) => c.user_id !== callerId)
            .map((c: any) => ({
              user_id: c.user_id,
              type: "player_checked_in",
              title: "Người thi đấu đã check-in",
              body: `${playerName} đã check-in deal "${label}" tại CLB.`,
              data: { deal_id: dealId, club_id: deal.club_id },
            }));
          if (cNotis.length) await admin.from("notifications").insert(cNotis);
        }
        const { data: club } = await admin
          .from("clubs")
          .select("owner_id")
          .eq("id", deal.club_id)
          .maybeSingle();
        if (club?.owner_id && club.owner_id !== callerId) {
          await admin.from("notifications").insert({
            user_id: club.owner_id,
            type: "player_checked_in",
            title: "Người thi đấu đã check-in tại CLB của bạn",
            body: `${playerName} đã check-in deal "${label}".`,
            data: { deal_id: dealId, club_id: deal.club_id },
          });
        }
      }
    } catch (_) { /* non-critical */ }

    // Audit
    await admin.from("staking_audit_logs").insert({
      deal_id: dealId,
      action: "updated",
      performed_by: callerId,
      old_status: "funded",
      new_status: "funded",
      metadata: { event: "player_checked_in", at: nowIso, by_role: isSuper ? "super_admin" : "cashier" },
    });

    // Player owes: (Buy-in × markup × (100-filled%)/100) + platform fixed fee
    // But for simplicity & to match Cashier UX: remaining = buy_in - sum_funded (already shown).
    // We surface the fixed fee here so the cashier can collect it together.
    const fixedFee = Number(deal.platform_fixed_fee ?? 49000);

    return j({
      ok: true,
      deal_id: dealId,
      checked_in_at: nowIso,
      notified_backers: backerIds.length,
      buy_in_vnd: Number(deal.buy_in_amount_vnd ?? 0),
      filled_percent: Number(deal.filled_percent ?? 0),
      platform_fixed_fee: fixedFee,
    });
  } catch (e) {
    return j({ error: (e as Error).message }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
