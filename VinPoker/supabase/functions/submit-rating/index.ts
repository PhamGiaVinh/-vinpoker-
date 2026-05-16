import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  deal_id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth }, fetch: retryFetch } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const { deal_id: dealId, rating } = parsed.data;
    const comment = parsed.data.comment || null;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: deal } = await admin.from("staking_deals")
      .select("id,player_id,status,completed_at").eq("id", dealId).maybeSingle();
    if (!deal) return json({ error: "Deal not found" }, 404);
    if (deal.status !== "completed") return json({ error: "Deal chưa hoàn tất" }, 400);
    if (!deal.completed_at) return json({ error: "Deal thiếu completed_at" }, 400);

    const ageMs = Date.now() - new Date(deal.completed_at).getTime();
    if (ageMs > 7 * 24 * 60 * 60 * 1000) return json({ error: "Đã quá 7 ngày để đánh giá" }, 400);

    let role: "player" | "backer";
    let rateeId: string;
    if (user.id === deal.player_id) {
      // Player rates each backer? Simpler MVP: rate as a single rating tied to the deal counterparty.
      // Find the largest funded backer (most representative). For MVP allow Player to rate any 1 backer per deal.
      const { data: purchases } = await admin.from("staking_purchases")
        .select("backer_id,percent").eq("deal_id", dealId).eq("status", "funded")
        .order("percent", { ascending: false }).limit(1);
      const top = purchases?.[0];
      if (!top) return json({ error: "Không có Backer nào trong deal" }, 400);
      role = "player";
      rateeId = top.backer_id;
    } else {
      // Verify user is a funded backer of this deal
      const { data: mine } = await admin.from("staking_purchases")
        .select("id").eq("deal_id", dealId).eq("backer_id", user.id).eq("status", "funded").limit(1);
      if (!mine?.length) return json({ error: "Bạn không phải Backer của deal này" }, 403);
      role = "backer";
      rateeId = deal.player_id;
    }

    const { error } = await admin.from("deal_ratings").insert({
      deal_id: dealId, rater_id: user.id, ratee_id: rateeId, role, rating, comment,
    });
    if (error) {
      if (error.code === "23505") return json({ error: "Bạn đã đánh giá deal này rồi" }, 409);
      return json({ error: error.message }, 400);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
