// Phase 6: Player closes their deal early (accept partial fill).
// Sets early_closed=true. Status:
//   - committing -> committed (no new commitments accepted)
//   - listing (no purchases yet) -> cancelled (early_closed=true, no funded => cron will keep it cancelled)
import { parseBody, z } from "../_shared/validate.ts";
import {
  corsHeaders,
  json,
  createAdminClient,
  authenticateUser,
} from "../_shared/staking-common.ts";

const BodySchema = z.object({ deal_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await authenticateUser(req);
    if (auth instanceof Response) return auth;
    const uid = auth.uid;

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const admin = createAdminClient();
    const { data: deal } = await admin
      .from("staking_deals")
      .select("id, player_id, status, filled_percent, percentage_sold, early_closed")
      .eq("id", body.deal_id)
      .maybeSingle();
    if (!deal) return json({ error: "Deal not found" }, 404);
    if (deal.player_id !== uid) return json({ error: "Forbidden" }, 403);
    if (deal.early_closed) return json({ error: "Already closed early" }, 409);
    if (!["listing", "committing"].includes(String(deal.status))) {
      return json({ error: `Cannot close from status=${deal.status}` }, 409);
    }

    // Determine new status
    const { data: rows } = await admin
      .from("staking_purchases")
      .select("status, percent")
      .eq("deal_id", deal.id);
    const live = (rows ?? []).filter((r: any) => r.status === "committed" || r.status === "funded");
    const totalLive = live.reduce((s, r: any) => s + Number(r.percent), 0);

    let newStatus = deal.status;
    if (totalLive === 0) newStatus = "cancelled";
    else if (deal.status === "committing") newStatus = "committed";

    const { error: upErr } = await admin
      .from("staking_deals")
      .update({
        early_closed: true,
        early_closed_at: new Date().toISOString(),
        status: newStatus,
        cancellation_reason: newStatus === "cancelled" ? "early_closed_no_purchases" : null,
      })
      .eq("id", deal.id);
    if (upErr) return json({ error: upErr.message }, 500);

    await admin.from("staking_audit_logs").insert({

    return json({ success: true, deal_status: newStatus, filled_percent: totalLive });
  } catch (e: any) {
    return json({ error: e?.message ?? "internal" }, 500);
  }
});
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
