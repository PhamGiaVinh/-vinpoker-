import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const body = await req.json();
  const { tournament_id, action } = body;

  if (!tournament_id || !action) return new Response(JSON.stringify({ error: "Missing tournament_id or action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let result: any;

  try {
    switch (action) {
      case "start": {
        const { current_level } = body;
        result = await supabase.rpc("update_tournament_state", {
          p_tournament_id: tournament_id,
          p_status: "live",
          p_reason: "Clock started",
        });
        if (!result.error) {
          await supabase.from("tournaments").update({
            clock_started_at: new Date().toISOString(),
            clock_paused_at: null,
            current_level: current_level || 1,
          }).eq("id", tournament_id);
        }
        break;
      }
      case "pause": {
        result = await supabase.from("tournaments").update({
          clock_paused_at: new Date().toISOString(),
        }).eq("id", tournament_id);
        break;
      }
      case "resume": {
        const { data: tournament } = await supabase.from("tournaments").select("clock_started_at, clock_paused_at, pause_accumulated").eq("id", tournament_id).single();
        if (tournament && tournament.clock_paused_at) {
          const pausedDuration = Math.floor((new Date().getTime() - new Date(tournament.clock_paused_at).getTime()) / 1000);
          const newAccumulated = (tournament.pause_accumulated || 0) + pausedDuration;
          result = await supabase.from("tournaments").update({
            clock_paused_at: null,
            pause_accumulated: newAccumulated,
          }).eq("id", tournament_id);
        }
        break;
      }
      case "next_level": {
        const { current_level } = body;
        result = await supabase.from("tournaments").update({
          current_level,
        }).eq("id", tournament_id);
        break;
      }
      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (result.error) throw result.error;

    const clockResult = await supabase.rpc("get_tournament_clock", { p_tournament_id: tournament_id });
    return new Response(JSON.stringify({ status: "success", clock: clockResult.data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});