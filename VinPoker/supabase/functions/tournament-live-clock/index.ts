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
      case "previous_level": {
        // Mirror of next_level (canonical behavior = set current_level only; the stored
        // blind structure in tournament_levels and the clock model are unchanged).
        // Guarded server-side: cannot go below the first level.
        const { data: tournament, error: tErr } = await supabase
          .from("tournaments")
          .select("current_level")
          .eq("id", tournament_id)
          .single();
        if (tErr) throw tErr;
        const cur = tournament?.current_level ?? 1;
        if (cur <= 1) {
          return new Response(JSON.stringify({ error: "Already at the first level" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        result = await supabase.from("tournaments").update({
          current_level: cur - 1,
        }).eq("id", tournament_id);
        break;
      }
      case "adjust_time": {
        // Adjust ONLY the current clock's remaining time by shifting clock_started_at.
        // The stored blind structure (tournament_levels) stays the source of truth and is
        // never modified. Works whether the clock is running or paused (both derive elapsed
        // from clock_started_at). Clamps remaining into [0, current level duration].
        const rawDelta = typeof body.delta_seconds === "number"
          ? body.delta_seconds
          : (typeof body.delta_minutes === "number" ? body.delta_minutes * 60 : NaN);
        if (!Number.isFinite(rawDelta) || Math.trunc(rawDelta) !== rawDelta) {
          return new Response(JSON.stringify({ error: "Invalid delta (expect integer delta_seconds or delta_minutes)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const MAX_DELTA = 24 * 60 * 60; // reject absurd single-call adjustments
        if (Math.abs(rawDelta) > MAX_DELTA) {
          return new Response(JSON.stringify({ error: "Delta too large" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const { data: tournament, error: tErr } = await supabase
          .from("tournaments")
          .select("clock_started_at")
          .eq("id", tournament_id)
          .single();
        if (tErr) throw tErr;
        if (!tournament?.clock_started_at) {
          return new Response(JSON.stringify({ error: "Clock not started" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // Derive current remaining + level duration from the stored structure.
        const { data: clockNow, error: cErr } = await supabase.rpc("get_tournament_clock", { p_tournament_id: tournament_id });
        if (cErr) throw cErr;
        const cur: any = clockNow;
        const durationMin = cur?.current_level?.duration_minutes;
        if (typeof durationMin !== "number") {
          return new Response(JSON.stringify({ error: "No current level to adjust" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        const levelDurationS = durationMin * 60;
        const currentRemaining = typeof cur.remaining_seconds === "number" ? cur.remaining_seconds : 0;
        // Clamp target remaining to [0, level duration] — never below 0, never above the
        // stored level's full duration (adjust can't fabricate time beyond the structure).
        const targetRemaining = Math.max(0, Math.min(levelDurationS, currentRemaining + rawDelta));
        const effectiveDelta = targetRemaining - currentRemaining; // +remaining => start later
        const newStarted = new Date(new Date(tournament.clock_started_at).getTime() + effectiveDelta * 1000).toISOString();
        result = await supabase.from("tournaments").update({
          clock_started_at: newStarted,
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