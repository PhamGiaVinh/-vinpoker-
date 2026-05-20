// Cashier marks a player as busted (eliminated with no prize).
// Sets player_busted_out=true on the deal, triggering early_closed + backer notifications.
// Auth: cashier (is_club_cashier or super_admin)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  deal_id: z.string().uuid(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader }, fetch: retryFetch } }
    );
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Invalid token" }, 401);
    const uid = userData.user.id;

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch deal to verify cashier has access to the club
    const { data: deal, error: dErr } = await admin
      .from("staking_deals")
      .select("id, club_id, status, player_id, custom_event_name")
      .eq("id", body.deal_id)
      .maybeSingle();
    if (dErr) return json({ error: dErr.message }, 500);
    if (!deal) return json({ error: "Deal not found" }, 404);
    if (deal.player_busted_out) return json({ error: "Player already marked as busted" }, 400);

    // Verify cashier access
    const { data: cashierClubs } = await admin.rpc("cashier_club_ids", { _user_id: uid });
    const clubIds = (cashierClubs ?? []).map((r: any) => (typeof r === "string" ? r : r.cashier_club_ids ?? r));
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .maybeSingle();
    const isSuperAdmin = roles?.role === "super_admin";

    if (!isSuperAdmin && !clubIds.includes(deal.club_id)) {
      return json({ error: "Forbidden — not a cashier for this club" }, 403);
    }

    // Mark as busted
    const { error: updErr } = await admin
      .from("staking_deals")
      .update({
        player_busted_out: true,
        result_prize_vnd: 0,
        placement: "Busted",
        status: "result_entered",
        result_entered_at: new Date().toISOString(),
        result_entered_by: uid,
      })
      .eq("id", body.deal_id);
    if (updErr) return json({ error: updErr.message }, 500);

    // Audit log
    await admin.from("staking_audit_logs").insert({
      deal_id: body.deal_id,
      action: "player_marked_busted",
      performed_by: uid,
      old_status: deal.status,
      new_status: "result_entered",
      metadata: { reason: "Cashier marked player as busted (no prize)" },
    });

    return json({ success: true, status: "result_entered", player_busted_out: true });
  } catch (e: any) {
    return json({ error: e?.message ?? "internal" }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
