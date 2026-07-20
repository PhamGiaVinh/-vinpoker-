import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  clockControlErrorStatus,
  isPostStartClockAction,
  isTerminalTournamentStatus,
  parseClockDelta,
  readExpectedControlRevision,
  readLegacyControlRevision,
} from "./controlPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

type JsonRecord = Record<string, unknown>;
type FloorOperatorScope = {
  club_id: string;
  can_owner: boolean;
  can_cashier: boolean;
  can_floor: boolean;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function response(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return response({ error: "Missing Authorization header" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return response({ error: "Server configuration missing" }, 500);
  }

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

  const tournamentId = typeof body.tournament_id === "string"
    ? body.tournament_id
    : null;
  const action = typeof body.action === "string" ? body.action : null;
  if (!tournamentId || !action) {
    return response({ error: "Missing tournament_id or action" }, 400);
  }

  try {
    const { data: tournament, error: tournamentError } = await supabase
      .from("tournaments")
      .select("id,club_id,status")
      .eq("id", tournamentId)
      .maybeSingle();
    if (tournamentError || !tournament) {
      return response({ error: "Tournament unavailable" }, 403);
    }

    const scopeResult = await supabase.rpc("get_my_floor_operator_scope");
    if (scopeResult.error) {
      return response({ error: "Capability check failed" }, 403);
    }
    const permittedClubIds = new Set(
      ((scopeResult.data ?? []) as FloorOperatorScope[])
        .filter((scope) =>
          scope.can_owner || scope.can_cashier || scope.can_floor
        )
        .map((scope) => scope.club_id),
    );
    if (!permittedClubIds.has(tournament.club_id)) {
      return response({ error: "Actor not allowed" }, 403);
    }
    if (isTerminalTournamentStatus(tournament.status)) {
      return response({ error: "Tournament is not open" }, 409);
    }

    if (action === "start") {
      const startResult = await supabase.rpc("floor_start_tournament_clock", {
        p_tournament_id: tournamentId,
      });
      if (startResult.error) throw startResult.error;
      if (!isRecord(startResult.data) || startResult.data.ok !== true) {
        const code = isRecord(startResult.data) &&
            typeof startResult.data.error === "string"
          ? startResult.data.error
          : "clock_start_failed";
        return response({ error: code }, clockControlErrorStatus(code));
      }
    } else {
      if (!isPostStartClockAction(action)) {
        return response({ error: "invalid_action" }, 400);
      }
      let expectedControlRevision = readExpectedControlRevision(body);
      if (
        !expectedControlRevision &&
        Object.prototype.hasOwnProperty.call(body, "expected_control_revision")
      ) {
        return response({ error: "expected_control_revision_required" }, 400);
      }
      if (!expectedControlRevision) {
        const legacyClockResult = await supabase.rpc("get_tournament_clock", {
          p_tournament_id: tournamentId,
        });
        if (legacyClockResult.error) throw legacyClockResult.error;
        expectedControlRevision = readLegacyControlRevision(
          action,
          body,
          legacyClockResult.data,
        );
        if (!expectedControlRevision) {
          return response({ error: "legacy_client_revision_required" }, 400);
        }
      }

      let deltaSeconds: number | null = null;
      if (action === "adjust_time") {
        const parsedDelta = parseClockDelta(body);
        if (!parsedDelta.ok) {
          return response({ error: parsedDelta.error }, 400);
        }
        deltaSeconds = parsedDelta.value;
      }

      const controlResult = await supabase.rpc(
        "floor_control_tournament_clock",
        {
          p_tournament_id: tournamentId,
          p_action: action,
          p_delta_seconds: deltaSeconds,
          p_expected_control_revision: expectedControlRevision,
        },
      );
      if (controlResult.error) throw controlResult.error;
      if (!isRecord(controlResult.data) || controlResult.data.ok !== true) {
        const code = isRecord(controlResult.data) &&
            typeof controlResult.data.error === "string"
          ? controlResult.data.error
          : "clock_control_failed";
        return response({ error: code }, clockControlErrorStatus(code));
      }
    }

    const clockResult = await supabase.rpc("get_tournament_clock", {
      p_tournament_id: tournamentId,
    });
    if (clockResult.error) throw clockResult.error;
    return response({ status: "success", clock: clockResult.data });
  } catch (error) {
    console.error("tournament-live-clock failed");
    return response({ error: "clock_operation_failed" }, 500);
  }
});
