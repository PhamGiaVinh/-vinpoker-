// Super-admin only: set new active USDT/VND rate. Trigger auto-deactivates the previous one.
import { createClient } from "npm:@supabase/supabase-js@2.105.4";

import { retryFetch } from "../_shared/retry.ts";
import { parseBody, z } from "../_shared/validate.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  rate_vnd_per_usdt: z.number().min(1000).max(100000),
  spread_percent: z.number().min(0).max(20).default(0),
  note: z.string().trim().max(500).optional(),
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
    const { data: userData, error: cErr } = await userClient.auth.getUser(
      authHeader.replace(/^Bearer\s+/i, ""),
    );
    if (cErr || !userData?.user?.id) return j({ error: "Invalid token" }, 401);
    const uid = userData.user.id;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", uid).eq("role", "super_admin").maybeSingle();
    if (!roleRow) return j({ error: "Forbidden: super_admin only" }, 403);

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const rate = body.rate_vnd_per_usdt;
    const spread = body.spread_percent;

    const { data: ins, error } = await admin
      .from("usdt_exchange_rates")
      .insert({
        rate_vnd_per_usdt: rate,
        spread_percent: spread,
        set_by: uid,
        is_active: true,
        note: (body?.note ?? "").trim() || null,
      })
      .select("id, rate_vnd_per_usdt, spread_percent, buy_rate, effective_from")
      .single();
    if (error) return j({ error: error.message }, 500);

    return j({ success: true, rate: ins });
  } catch (e: any) {
    return j({ error: e?.message ?? "internal" }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
