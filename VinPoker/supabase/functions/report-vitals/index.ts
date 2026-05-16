import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MetricSchema = z.object({
  name: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
  value: z.number().finite().min(0).max(1e7),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  id: z.string().min(1).max(120),
  delta: z.number().finite().optional(),
  navigationType: z.string().max(40).optional(),
  page: z.string().max(500).optional(),
  ts: z.number().int().optional(),
});

const BodySchema = z.union([MetricSchema, z.array(MetricSchema).max(20)]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const metrics = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  if (metrics.length === 0) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const ua = (req.headers.get("user-agent") ?? "").slice(0, 300);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const rows = metrics.map((m) => ({
    metric_name: m.name,
    metric_value: m.value,
    rating: m.rating ?? null,
    metric_id: m.id,
    delta: m.delta ?? null,
    navigation_type: m.navigationType ?? null,
    page: m.page ?? null,
    user_agent: ua,
  }));

  const { error } = await supabase.from("web_vitals_events").insert(rows);
  if (error) {
    console.error("report-vitals insert failed:", error.message);
    return new Response(JSON.stringify({ error: "Insert failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(null, { status: 204, headers: corsHeaders });
});
