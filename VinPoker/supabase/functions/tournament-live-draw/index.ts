import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
type SeatRow = {
  id: string;
  tournament_id: string;
  player_id: string;
  entry_id: string | null;
  entry_number: number;
  table_id: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
};
type EntryRow = {
  id: string;
  tournament_id: string;
  player_id: string;
  entry_no: number;
  status: string;
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

    if (action === "get_seats") {
      const result = await supabase.rpc("get_seats_for_draw", {
        p_tournament_id: tournamentId,
      });
      if (result.error) throw result.error;
      return response({ status: "success", data: result.data });
    }

    if (action === "add_table" || action === "add_player") {
      return response(
        { error: "Use the audited Floor RPC for this action" },
        410,
      );
    }
    if (action !== "update_seats") {
      return response({ error: "Invalid action" }, 400);
    }

    // Every supported Floor call updates one seat. Refuse an arbitrary batch here:
    // each seat mutation is atomic, but a client-side loop cannot make a multi-seat
    // request atomic as a whole.
    if (!Array.isArray(body.seats) || body.seats.length !== 1) {
      return response({ error: "update_seats accepts exactly one seat" }, 400);
    }

    const rows = body.seats;

    let updated = 0;
    let unchanged = 0;
    for (const rawSeat of rows) {
      if (!isRecord(rawSeat) || typeof rawSeat.seat_id !== "string") {
        return response({
          error: "seat_id is required; inserts are not allowed",
        }, 400);
      }

      const seatResult = await supabase
        .from("tournament_seats")
        .select(
          "id,tournament_id,player_id,entry_id,entry_number,table_id,seat_number,chip_count,is_active",
        )
        .eq("id", rawSeat.seat_id)
        .eq("tournament_id", tournamentId)
        .maybeSingle();
      const existing = seatResult.data as SeatRow | null;
      const seatError = seatResult.error;
      if (seatError || !existing) {
        return response({ error: "seat_not_found" }, 409);
      }

      const identityMismatch = (typeof rawSeat.player_id === "string" &&
        rawSeat.player_id !== existing.player_id) ||
        (typeof rawSeat.entry_number === "number" &&
          rawSeat.entry_number !== existing.entry_number) ||
        (typeof rawSeat.table_id === "string" &&
          rawSeat.table_id !== existing.table_id) ||
        (typeof rawSeat.seat_number === "number" &&
          rawSeat.seat_number !== existing.seat_number);
      if (identityMismatch || !existing.entry_id) {
        return response({ error: "seat_entry_mismatch" }, 409);
      }

      const entryResult = await supabase
        .from("tournament_entries")
        .select("id,tournament_id,player_id,entry_no,status")
        .eq("id", existing.entry_id)
        .maybeSingle();
      const entry = entryResult.data as EntryRow | null;
      const entryError = entryResult.error;
      if (
        entryError || !entry ||
        entry.tournament_id !== tournamentId ||
        entry.player_id !== existing.player_id ||
        entry.entry_no !== existing.entry_number
      ) {
        return response({ error: "seat_entry_mismatch" }, 409);
      }

      const requestedActive = rawSeat.is_active !== false;
      if (!requestedActive) {
        if (!existing.is_active) {
          unchanged += 1;
          continue;
        }
        if (entry.status !== "seated") {
          return response({ error: "entry_not_seated" }, 409);
        }
        if (
          typeof rawSeat.chip_count !== "number" ||
          rawSeat.chip_count !== existing.chip_count
        ) {
          return response({ error: "stale_seat_state" }, 409);
        }

        const { data: bustData, error: bustError } = await supabase.rpc(
          "floor_bust_player",
          {
            p_tournament_id: tournamentId,
            p_seat_id: existing.id,
            p_expected_chip_count: existing.chip_count,
            p_reason: "tournament_live_draw",
          },
        );
        if (bustError) throw bustError;
        if (!isRecord(bustData) || bustData.ok !== true) {
          const bustCode =
            isRecord(bustData) && typeof bustData.error === "string"
              ? bustData.error
              : "bust_failed";
          const conflictCodes = new Set([
            "stale_seat_state",
            "seat_entry_mismatch",
            "entry_not_seated",
            "seat_not_active",
            "already_busted",
            "player_has_chips",
            "player_in_active_hand",
          ]);
          return response(
            { error: bustCode },
            conflictCodes.has(bustCode) ? 409 : 400,
          );
        }
        updated += 1;
        continue;
      }

      if (!existing.is_active) {
        return response({ error: "restore_requires_rpc" }, 409);
      }
      if (entry.status !== "seated") {
        return response({ error: "entry_not_seated" }, 409);
      }
      const nextChip = rawSeat.chip_count;
      const expectedChip = rawSeat.expected_chip_count;
      if (
        typeof nextChip !== "number" ||
        !Number.isSafeInteger(nextChip) ||
        nextChip < 0 ||
        typeof expectedChip !== "number" ||
        !Number.isSafeInteger(expectedChip) ||
        expectedChip < 0
      ) {
        return response({
          error:
            "chip_count and expected_chip_count must be non-negative integers",
        }, 400);
      }
      if (expectedChip !== existing.chip_count) {
        return response({ error: "stale_seat_state" }, 409);
      }
      if (nextChip === existing.chip_count) {
        unchanged += 1;
        continue;
      }

      const { data: changed, error: updateError } = await supabase
        .from("tournament_seats")
        .update({ chip_count: nextChip })
        .eq("id", existing.id)
        .eq("tournament_id", tournamentId)
        .eq("is_active", true)
        .eq("chip_count", expectedChip)
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!changed) return response({ error: "stale_seat_state" }, 409);
      updated += 1;
    }

    return response({ status: "success", data: { updated, unchanged } });
  } catch {
    console.error("tournament-live-draw failed");
    return response({ error: "draw_operation_failed" }, 500);
  }
});
