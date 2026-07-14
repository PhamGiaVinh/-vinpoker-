import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function response(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Internal error";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return response({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return response({ error: "Server configuration missing" }, 500);

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return response({ error: "Unauthorized" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return response({ error: "Invalid JSON body" }, 400);
  }
  if (!isRecord(body)) return response({ error: "Invalid request body" }, 400);

  const tournamentId = typeof body.tournament_id === "string" ? body.tournament_id : null;
  const action = typeof body.action === "string" ? body.action : null;
  if (!tournamentId || !action) return response({ error: "Missing tournament_id or action" }, 400);

  try {
    const { data: tournament, error: tournamentError } = await supabase
      .from("tournaments")
      .select("id,club_id,status,current_level,clock_started_at,clock_paused_at,pause_accumulated")
      .eq("id", tournamentId)
      .maybeSingle();
    if (tournamentError || !tournament) return response({ error: "Tournament unavailable" }, 403);

    const [floorResult, cashierResult] = await Promise.all([
      supabase.rpc("floor_club_ids", { _user_id: user.id }),
      supabase.rpc("cashier_club_ids", { _user_id: user.id }),
    ]);
    if (floorResult.error || cashierResult.error) return response({ error: "Capability check failed" }, 403);
    const permittedClubIds = new Set([...(floorResult.data ?? []), ...(cashierResult.data ?? [])]);
    if (!permittedClubIds.has(tournament.club_id)) return response({ error: "Actor not allowed" }, 403);
    if (tournament.status === "completed" || tournament.status === "cancelled") {
      return response({ error: "Tournament is not open" }, 409);
    }

    const updateOne = async (patch: JsonRecord, expected?: { column: string; value: unknown }) => {
      let query = supabase.from("tournaments").update(patch).eq("id", tournamentId);
      if (expected) query = expected.value === null ? query.is(expected.column, null) : query.eq(expected.column, expected.value);
      const { data, error } = await query.select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("stale_clock_state");
    };

    switch (action) {
      case "start": {
        const { data: firstLevel, error: levelError } = await supabase
          .from("tournament_levels")
          .select("level_number")
          .eq("tournament_id", tournamentId)
          .order("level_number", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (levelError) throw levelError;
        const level = tournament.current_level ?? firstLevel?.level_number;
        if (typeof level !== "number") return response({ error: "No tournament level configured" }, 409);

        const stateResult = await supabase.rpc("update_tournament_state", {
          p_tournament_id: tournamentId,
          p_status: "live",
          p_reason: "Clock started",
        });
        if (stateResult.error) throw stateResult.error;
        await updateOne({
          clock_started_at: new Date().toISOString(),
          clock_paused_at: null,
          pause_accumulated: 0,
          current_level: level,
        });
        break;
      }

      case "pause": {
        if (!tournament.clock_started_at) return response({ error: "Clock not started" }, 409);
        if (!tournament.clock_paused_at) {
          await updateOne({ clock_paused_at: new Date().toISOString() }, { column: "clock_paused_at", value: null });
        }
        break;
      }

      case "resume": {
        if (!tournament.clock_started_at) return response({ error: "Clock not started" }, 409);
        if (tournament.clock_paused_at) {
          const pausedDuration = Math.floor((Date.now() - new Date(tournament.clock_paused_at).getTime()) / 1000);
          const pauseAccumulated = (tournament.pause_accumulated ?? 0) + Math.max(0, pausedDuration);
          await updateOne(
            { clock_paused_at: null, pause_accumulated: pauseAccumulated },
            { column: "clock_paused_at", value: tournament.clock_paused_at },
          );
        }
        break;
      }

      case "next_level":
      case "previous_level": {
        const current = tournament.current_level ?? 1;
        const direction = action === "next_level" ? 1 : -1;
        const target = current + direction;
        if (target < 1) return response({ error: "Already at the first level" }, 400);
        const { data: targetLevel, error: levelError } = await supabase
          .from("tournament_levels")
          .select("level_number")
          .eq("tournament_id", tournamentId)
          .eq("level_number", target)
          .maybeSingle();
        if (levelError) throw levelError;
        if (!targetLevel) return response({ error: "Target level does not exist" }, 409);
        await updateOne({ current_level: target }, { column: "current_level", value: tournament.current_level });
        break;
      }

      case "adjust_time": {
        const delta = typeof body.delta_seconds === "number"
          ? body.delta_seconds
          : typeof body.delta_minutes === "number"
            ? body.delta_minutes * 60
            : Number.NaN;
        if (!Number.isSafeInteger(delta)) return response({ error: "Delta must be an integer" }, 400);
        if (Math.abs(delta) > 24 * 60 * 60) return response({ error: "Delta too large" }, 400);
        if (!tournament.clock_started_at) return response({ error: "Clock not started" }, 409);

        const { data: clockNow, error: clockError } = await supabase.rpc("get_tournament_clock", {
          p_tournament_id: tournamentId,
        });
        if (clockError) throw clockError;
        const clock = isRecord(clockNow) ? clockNow : null;
        const currentLevel = clock && isRecord(clock.current_level) ? clock.current_level : null;
        const durationMinutes = currentLevel?.duration_minutes;
        const remainingSeconds = clock?.remaining_seconds;
        if (typeof durationMinutes !== "number" || typeof remainingSeconds !== "number") {
          return response({ error: "No current level to adjust" }, 409);
        }

        const levelDuration = durationMinutes * 60;
        const targetRemaining = Math.max(0, Math.min(levelDuration, remainingSeconds + delta));
        const effectiveDelta = targetRemaining - remainingSeconds;
        const startedAt = new Date(new Date(tournament.clock_started_at).getTime() + effectiveDelta * 1000).toISOString();
        await updateOne(
          { clock_started_at: startedAt },
          { column: "clock_started_at", value: tournament.clock_started_at },
        );
        break;
      }

      default:
        return response({ error: "Invalid action" }, 400);
    }

    const clockResult = await supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId });
    if (clockResult.error) throw clockResult.error;
    return response({ status: "success", clock: clockResult.data });
  } catch (error) {
    const detail = errorMessage(error);
    return response({ error: detail }, detail === "stale_clock_state" ? 409 : 500);
  }
});
