// Public: returns active USDT/VND exchange rate (for backers + UI display).
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

import { retryFetch } from "../_shared/retry.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await admin
      .from("usdt_exchange_rates")
      .select("id, rate_vnd_per_usdt, spread_percent, buy_rate, effective_from")
      .eq("is_active", true)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return j({ error: error.message }, 500);
    if (!data) return j({ error: "No active rate. Admin chưa cấu hình tỷ giá." }, 404);
    return j(data);
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
