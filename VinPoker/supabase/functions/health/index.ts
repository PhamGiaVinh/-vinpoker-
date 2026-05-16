import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const timestamp = new Date().toISOString();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    // Lightweight DB ping with 2s timeout
    const ping = supabase
      .from("web_vitals_events")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    const timeout = new Promise<{ error: { message: string } }>((resolve) =>
      setTimeout(
        () => resolve({ error: { message: "timeout" } }),
        2000,
      ),
    );
    const result = (await Promise.race([ping, timeout])) as {
      error: { message: string } | null;
    };

    if (result.error) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Database unreachable",
          timestamp,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({ status: "ok", db: "ok", timestamp }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        status: "error",
        message: "Database unreachable",
        detail: (e as Error).message,
        timestamp,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
