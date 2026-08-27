import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  nextToAct,
  reconcileSidePots,
  reduceHand,
  validateAction,
  type ActionRow,
  type PlayerSeed,
  type ProposedAction,
  type Street,
} from "../_shared/trackerEngine/index.ts";
import { parseTrackerVoiceCommand } from "../_shared/trackerVoiceParser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rollout safety: default to "warn" so merging this never blocks a live operator
// on a reconstruction edge case. Flip to "enforce" via env only after UAT.
//   TRACKER_VALIDATION_MODE = "warn" | "enforce" | "off"
const VALIDATION_MODE = (Deno.env.get("TRACKER_VALIDATION_MODE") || "warn").toLowerCase();
// Strict clockwise turn order is the most likely source of false rejections for
// live entry (heads-up, straddles, out-of-turn-but-allowed). Off by default even
// in enforce mode; opt in explicitly.
const ENFORCE_TURN_ORDER = (Deno.env.get("TRACKER_ENFORCE_TURN_ORDER") || "false") === "true";
const VOICE_AUTO_ENABLED = (Deno.env.get("TRACKER_VOICE_AUTO_ENABLED") || "false") === "true";
const VOICE_CAPABILITY_VERSION = Deno.env.get("TRACKER_VOICE_CAPABILITY_VERSION") || "tracker-voice-v0";

type VoiceSnapshot = {
  ok: boolean;
  error?: string;
  hand_id: string;
  button_seat: number;
  community_cards: string[];
  state_version: string;
  correction_pending: boolean;
  configured_mode: "shadow" | "assist" | "auto";
  provider_model: string;
  spoken_amount_unit: number;
  amount_unit_confirmed: boolean;
  players: Array<PlayerSeed & { entry_number: number }>;
  actions: ActionRow[];
};

function streetForBoard(board: string[]): Street {
  if (board.length >= 5) return "river";
  if (board.length === 4) return "turn";
  if (board.length === 3) return "flop";
  return "preflop";
}

function clockwiseAfter<T extends { seat_number: number }>(players: T[], seat: number): T | null {
  const ordered = [...players].sort((a, b) => a.seat_number - b.seat_number);
  return ordered.find((player) => player.seat_number > seat) ?? ordered[0] ?? null;
}

function resolveVoiceActor(snapshot: VoiceSnapshot, street: Street): {
  playerId: string;
  entryNumber: number;
  seatNumber: number;
  currentBet: number;
  stack: number;
  highestBet: number;
} | null {
  const runtime = reduceHand(snapshot.players, snapshot.actions, snapshot.button_seat);
  const hasStreetAction = snapshot.actions.some((action) => action.street === street);
  let playerId = nextToAct(snapshot.players, snapshot.actions, snapshot.button_seat);
  if (!playerId && !hasStreetAction && street !== runtime.street) {
    playerId = clockwiseAfter(
      runtime.players.filter((player) => !player.is_folded && !player.is_all_in),
      snapshot.button_seat,
    )?.player_id ?? null;
  }
  if (!playerId) return null;
  const player = runtime.players.find((candidate) => candidate.player_id === playerId);
  const seed = snapshot.players.find((candidate) => candidate.player_id === playerId);
  if (!player || !seed) return null;
  const newStreet = street !== runtime.street;
  return {
    playerId,
    entryNumber: seed.entry_number || 1,
    seatNumber: seed.seat_number,
    currentBet: newStreet ? 0 : player.street_bet,
    stack: player.stack,
    highestBet: newStreet ? 0 : runtime.highestBet,
  };
}

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

  // Load the trusted seeds + prior action stream + button for a hand so the
  // validation engine can reconstruct state. Server-authoritative — never the
  // client's view of state.
  async function loadHandForValidation(handId: string): Promise<
    { seeds: PlayerSeed[]; priorActions: ActionRow[]; buttonSeat: number } | null
  > {
    const [{ data: hand }, { data: hp }, { data: ha }] = await Promise.all([
      supabase.from("tournament_hands").select("button_seat").eq("id", handId).maybeSingle(),
      supabase.from("hand_players").select("player_id, seat_number, starting_stack").eq("hand_id", handId),
      supabase.from("hand_actions").select("player_id, street, action_type, action_amount, action_order").eq("hand_id", handId).order("action_order"),
    ]);
    if (!hand || !hp) return null;
    return {
      seeds: (hp as any[]).map((r) => ({
        player_id: r.player_id,
        seat_number: r.seat_number,
        starting_stack: r.starting_stack ?? 0,
      })),
      priorActions: (ha as any[] | null ?? []).map((r) => ({
        player_id: r.player_id,
        street: r.street ?? "preflop",
        action_type: r.action_type,
        action_amount: r.action_amount ?? 0,
        action_order: r.action_order,
      })),
      buttonSeat: (hand as any).button_seat ?? 1,
    };
  }

  const validationError = (code: string, message: string) =>
    new Response(JSON.stringify({ error: message, code, validation: { valid: false, code } }), {
      status: 422,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Structured telemetry for a rejected/flagged validation verdict. Emitted for
  // BOTH enforce (hard 422) and warn (recorded anyway) so rejects are visible in
  // the Supabase dashboard Edge logs (the CLI cannot read them, and enforce
  // rejects otherwise leave no trail). Logs only non-sensitive identifiers + the
  // verdict — never hole cards, amounts, full payload, secrets, or auth tokens.
  const logValidationReject = (
    fields: { validation_code: string; hand_id?: string; player_id?: string; action_type?: string; street?: string },
  ) =>
    console.warn(
      "[tracker-validation:reject]",
      JSON.stringify({
        validation_code: fields.validation_code,
        tournament_id,
        hand_id: fields.hand_id,
        player_id: fields.player_id,
        action_type: fields.action_type,
        street: fields.street,
        mode: VALIDATION_MODE,
        turn_order_enabled: ENFORCE_TURN_ORDER,
      }),
    );

  let result: any;
  let validationNote: any = undefined;

  try {
    switch (action) {
      case "record_hand": {
        const { table_id, hand_number, hand_time, players, actions, side_pots, community_cards, pot_size } = body;

        // Server never trusts client side_pots — recompute from the action stream.
        let authoritativeSidePots: any = side_pots || "[]";
        if (VALIDATION_MODE !== "off" && Array.isArray(actions)) {
          const recon = reconcileSidePots(actions as ActionRow[], side_pots);
          authoritativeSidePots = recon.serverSidePots; // authoritative, always
          if (recon.tampered) {
            logValidationReject({ validation_code: "SIDE_POTS_TAMPERED" });
            if (VALIDATION_MODE === "enforce") {
              return validationError("SIDE_POTS_TAMPERED", "side_pots không khớp với chuỗi hành động trên server.");
            }
            validationNote = { code: "SIDE_POTS_TAMPERED", overridden: true };
          }
        }

        result = await supabase.rpc("record_hand", {
          p_tournament_id: tournament_id,
          p_table_id: table_id,
          p_hand_number: hand_number,
          p_hand_time: hand_time,
          p_players: players,
          p_actions: actions,
          p_side_pots: authoritativeSidePots,
          p_community_cards: community_cards || "[]",
          p_pot_size: pot_size || 0,
          p_created_by: user.id,
        });
        break;
      }
      case "void_hand": {
        const { hand_id } = body;
        result = await supabase.rpc("void_last_hand", { p_hand_id: hand_id });
        break;
      }
      case "delete_last_action": {
        // Undo the single most-recent action of an in-progress hand (tablet
        // mis-tap). The RPC checks the hand lock and returns the deleted action.
        const { hand_id } = body;
        result = await supabase.rpc("delete_last_action", {
          p_hand_id: hand_id,
          p_user_id: user.id,
        });
        break;
      }
      case "update_stack": {
        const { player_id, entry_number, chip_count } = body;
        result = await supabase.rpc("update_stack", {
          p_tournament_id: tournament_id,
          p_player_id: player_id,
          p_entry_number: entry_number,
          p_chip_count: chip_count,
        });
        break;
      }
      case "bulk_update": {
        const { updates } = body;
        result = await supabase.rpc("bulk_update_stacks", {
          p_tournament_id: tournament_id,
          p_updates: updates,
        });
        break;
      }
      case "re_enter": {
        const { player_id, new_chip_count } = body;
        result = await supabase.rpc("re_enter_tournament", {
          p_tournament_id: tournament_id,
          p_player_id: player_id,
          p_new_chip_count: new_chip_count || 0,
        });
        break;
      }
      case "start_hand": {
        const { table_id, hand_number, hand_time, button_seat } = body;
        const normalizedButtonSeat =
          Number.isInteger(button_seat) && button_seat >= 1 && button_seat <= 10
            ? button_seat
            : 1;
        result = await supabase.rpc("start_hand", {
          p_tournament_id: tournament_id,
          p_table_id: table_id,
          p_hand_number: hand_number,
          p_hand_time: hand_time || new Date().toISOString(),
          p_created_by: user.id,
          p_button_seat: normalizedButtonSeat,
        });
        break;
      }
      case "update_community_cards": {
        const { hand_id, community_cards } = body;
        result = await supabase.rpc("update_community_cards", {
          p_hand_id: hand_id,
          p_community_cards: community_cards,
          p_user_id: user.id,
        });
        break;
      }
      case "record_action": {
        const {
          hand_id, player_id, entry_number, street, action_type, action_amount,
          action_order, idempotency_key, trace_id, source, tournament_table_id, voice_event_id,
          expected_state_version,
        } = body;

        if (source === "voice" && (
          typeof voice_event_id !== "string"
          || typeof tournament_table_id !== "string"
          || typeof idempotency_key !== "string"
          || typeof trace_id !== "string"
          || typeof expected_state_version !== "string"
        )) {
          return validationError("VOICE_METADATA_REQUIRED", "Voice action thiếu proof bắt buộc.");
        }

        if (VALIDATION_MODE !== "off" || source === "voice") {
          let loaded: { seeds: PlayerSeed[]; priorActions: ActionRow[]; buttonSeat: number } | null;
          if (source === "voice") {
            const { data: rawVoiceSnapshot, error: voiceSnapshotError } = await supabase.rpc(
              "get_tracker_voice_validation_snapshot",
              {
                p_tournament_id: tournament_id,
                p_tournament_table_id: tournament_table_id,
                p_hand_id: hand_id,
              },
            );
            const voiceSnapshot = rawVoiceSnapshot as VoiceSnapshot | null;
            if (voiceSnapshotError || !voiceSnapshot?.ok) {
              return validationError(
                voiceSnapshot?.error ?? "VOICE_SNAPSHOT_UNAVAILABLE",
                "Không tải được trạng thái hand hoặc assignment để xác minh Voice.",
              );
            }
            if (voiceSnapshot.state_version !== expected_state_version) {
              return validationError("STALE_STATE_VERSION", "Trạng thái bàn đã thay đổi. Hãy nói lại action.");
            }
            loaded = {
              seeds: voiceSnapshot.players,
              priorActions: voiceSnapshot.actions,
              buttonSeat: voiceSnapshot.button_seat,
            };
          } else {
            loaded = await loadHandForValidation(hand_id);
          }
          if (loaded) {
            const proposed: ProposedAction = {
              player_id,
              street: street || "preflop",
              action_type,
              action_amount: action_amount || 0,
              action_order,
            };
            const verdict = validateAction(loaded.seeds, loaded.priorActions, loaded.buttonSeat, proposed, {
              enforceTurnOrder: ENFORCE_TURN_ORDER,
            });
            if (!verdict.valid) {
              // Telemetry first so the reject is observable in BOTH modes
              // (enforce returns 422 below; warn records anyway).
              logValidationReject({ validation_code: verdict.code, hand_id, player_id, action_type, street: street || "preflop" });
              if (VALIDATION_MODE === "enforce" || source === "voice") {
                return validationError(verdict.code, verdict.message);
              }
              // warn: record anyway, but surface the verdict for observability.
              validationNote = { code: verdict.code, message: verdict.message, normalizedAmount: verdict.normalizedAmount };
            }
          }
        }

        result = await supabase.rpc("record_action", {
          p_hand_id: hand_id,
          p_player_id: player_id,
          p_entry_number: entry_number || 1,
          p_street: street || "preflop",
          p_action_type: action_type,
          p_action_amount: action_amount || 0,
          p_action_order: action_order,
          // Lock-owner binding + idempotent retry + trace plumbing (Session A).
          // NOTE: this Edge MUST be deployed only AFTER the record_action migration
          // (20260928000000) is live — the old signature lacks these params.
          p_user_id: user.id,
          p_idempotency_key: idempotency_key ?? null,
          p_trace_id: trace_id ?? null,
        });
        if (source === "voice" && result.data && typeof result.data === "object") {
          const verdict = result.data as { error?: unknown; voice_event_id?: unknown };
          if (typeof verdict.error === "string") {
            return new Response(JSON.stringify({ error: verdict.error, code: verdict.error }), {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (verdict.voice_event_id !== voice_event_id) {
            return validationError("VOICE_RECEIPT_MISMATCH", "Canonical receipt không khớp Voice event.");
          }
        }
        break;
      }
      case "validate_voice_event": {
        const {
          tournament_table_id, hand_id, final_transcript, provider_name,
          provider_model, provider_event_id, provider_confidence,
          execution_mode, expected_state_version, idempotency_key, trace_id,
        } = body;
        if (
          typeof tournament_table_id !== "string"
          || typeof hand_id !== "string"
          || typeof final_transcript !== "string"
          || final_transcript.length < 1
          || final_transcript.length > 500
          || typeof expected_state_version !== "string"
          || typeof idempotency_key !== "string"
          || typeof trace_id !== "string"
        ) {
          return validationError("VOICE_REQUEST_INVALID", "Voice event thiếu dữ liệu bắt buộc.");
        }

        const { data: rawSnapshot, error: snapshotError } = await supabase.rpc(
          "get_tracker_voice_validation_snapshot",
          {
            p_tournament_id: tournament_id,
            p_tournament_table_id: tournament_table_id,
            p_hand_id: hand_id,
          },
        );
        const snapshot = rawSnapshot as VoiceSnapshot | null;
        if (snapshotError || !snapshot?.ok) {
          const code = snapshot?.error ?? "VOICE_SNAPSHOT_UNAVAILABLE";
          return validationError(code, "Không thể xác minh assignment hoặc trạng thái bàn.");
        }
        if (snapshot.state_version !== expected_state_version) {
          return validationError("STALE_STATE_VERSION", "Trạng thái bàn đã thay đổi. Hãy nói lại action.");
        }
        if (snapshot.correction_pending) {
          return validationError("CORRECTION_PENDING", "Đang chờ Floor sửa action trước đó.");
        }

        const command = parseTrackerVoiceCommand(final_transcript, {
          spokenAmountUnit: snapshot.spoken_amount_unit,
          amountUnitConfirmed: snapshot.amount_unit_confirmed,
        });
        if (!command) return validationError("VOICE_COMMAND_UNKNOWN", "Không nhận ra lệnh poker.");
        if (command.amountAmbiguous) {
          return validationError("VOICE_AMOUNT_AMBIGUOUS", "Số chip chưa rõ đơn vị.");
        }

        const street = streetForBoard(snapshot.community_cards ?? []);
        const actionOrder = (snapshot.actions.at(-1)?.action_order ?? 0) + 1;
        let normalizedCommand: Record<string, unknown> = {
          kind: command.kind,
          normalized_transcript: command.normalizedTranscript,
        };

        if (command.kind !== "report_wrong_action" && command.kind !== "call_floor") {
          const actor = resolveVoiceActor(snapshot, street);
          if (!actor) return validationError("VOICE_ACTOR_UNAVAILABLE", "Không xác định được người đang tới lượt.");
          if (command.spokenSeatNumber !== null && command.spokenSeatNumber !== actor.seatNumber) {
            return validationError(
              "VOICE_ACTOR_MISMATCH",
              `Đang tới Ghế ${actor.seatNumber}, nhưng Voice nghe Ghế ${command.spokenSeatNumber}.`,
            );
          }
          const canonicalAction = command.kind === "bet_to"
            ? "bet"
            : command.kind === "raise_to"
              ? "raise"
              : command.kind;
          let actionAmount = 0;
          if (canonicalAction === "call") {
            actionAmount = Math.min(actor.stack, Math.max(0, actor.highestBet - actor.currentBet));
          } else if (canonicalAction === "all_in") {
            actionAmount = actor.stack;
          } else if (canonicalAction === "bet" || canonicalAction === "raise") {
            if (command.amount === null) return validationError("VOICE_AMOUNT_REQUIRED", "Bet/raise cần số chip.");
            actionAmount = command.amount - actor.currentBet;
          }

          const proposed: ProposedAction = {
            player_id: actor.playerId,
            street,
            action_type: canonicalAction,
            action_amount: actionAmount,
            action_order: actionOrder,
          };
          const verdict = validateAction(
            snapshot.players,
            snapshot.actions,
            snapshot.button_seat,
            proposed,
            { enforceTurnOrder: false },
          );
          if (!verdict.valid) {
            logValidationReject({
              validation_code: verdict.code,
              hand_id,
              player_id: actor.playerId,
              action_type: canonicalAction,
              street,
            });
            return validationError(verdict.code, verdict.message);
          }
          normalizedCommand = {
            ...normalizedCommand,
            canonical_action: canonicalAction,
            actor_player_id: actor.playerId,
            spoken_seat_number: command.spokenSeatNumber,
            entry_number: actor.entryNumber,
            street,
            action_amount: verdict.normalizedAmount,
            action_order: actionOrder,
          };
        }

        const mode = execution_mode === "auto" ? "auto" : execution_mode === "assist" ? "assist" : "shadow";
        if (mode === "auto" && (
          !VOICE_AUTO_ENABLED
          || VALIDATION_MODE !== "enforce"
          || !ENFORCE_TURN_ORDER
          || provider_confidence === null
          || provider_confidence === undefined
        )) {
          return validationError("AUTO_CAPABILITY_MISSING", "Auto chưa đủ capability server.");
        }

        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        if (!serviceKey || !supabaseUrl) {
          throw new Error("tracker_voice_service_not_configured");
        }
        const service = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        result = await service.rpc("_tracker_voice_register_validated_event", {
          p_actor_user_id: user.id,
          p_tournament_id: tournament_id,
          p_tournament_table_id: tournament_table_id,
          p_hand_id: hand_id,
          p_provider_name: provider_name === "mock"
            ? "mock"
            : provider_name === "gemini_live"
              ? "gemini_live"
              : "openai_realtime",
          p_provider_model: typeof provider_model === "string" ? provider_model : snapshot.provider_model,
          p_provider_event_id: typeof provider_event_id === "string" ? provider_event_id : null,
          p_provider_confidence: typeof provider_confidence === "number" ? provider_confidence : null,
          p_final_transcript: final_transcript,
          p_normalized_command: normalizedCommand,
          p_expected_state_version: expected_state_version,
          p_execution_mode: mode,
          p_idempotency_key: idempotency_key,
          p_trace_id: trace_id,
          p_validation_mode: "enforce",
          p_turn_order_enforced: true,
          p_capability_version: VOICE_CAPABILITY_VERSION,
        });
        break;
      }
      case "show_hole_cards": {
        const { hand_id, player_hole_cards } = body;
        result = await supabase.rpc("show_hole_cards", {
          p_hand_id: hand_id,
          p_player_hole_cards: player_hole_cards,
          p_user_id: user.id,
        });
        break;
      }
      case "heartbeat_lock": {
        const { hand_id } = body;
        result = await supabase.rpc("heartbeat_lock", {
          p_hand_id: hand_id,
          p_user_id: user.id,
        });
        break;
      }
      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (result.error) throw result.error;
    // `start_hand` returns a JSONB policy denial for an unclassified Manual
    // table. Do not wrap that as a successful Edge response: older callers
    // otherwise set local `handStarted=true` even though no hand was inserted.
    if (action === "start_hand" && result.data && typeof result.data === "object") {
      const verdict = result.data as { error?: unknown; error_code?: unknown };
      if (typeof verdict.error === "string") {
        const code = typeof verdict.error_code === "string" ? verdict.error_code : undefined;
        const message = code === "tracker_table_required"
          ? "Bàn này đang ở chế độ Manual Floor. Hãy chọn Live Tracker trước khi bắt đầu hand."
          : verdict.error;
        return new Response(JSON.stringify({ error: message, ...(code ? { code } : {}) }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // A JSONB denial from the canonical action RPC is an authoritative failure,
    // not a successful Edge envelope. This keeps non-Voice callers fail-closed too.
    if (action === "record_action" && result.data && typeof result.data === "object") {
      const verdict = result.data as { error?: unknown };
      if (typeof verdict.error === "string") {
        return new Response(JSON.stringify({ error: verdict.error, code: verdict.error }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // Echo the caller's trace_id (when present) for end-to-end correlation. The RPC
    // JSONB (in `data`) carries the authoritative verdict incl. duplicate/conflict/lock.
    return new Response(JSON.stringify({ status: "success", data: result.data, ...(body.trace_id ? { trace_id: body.trace_id } : {}), ...(validationNote ? { validation: validationNote } : {}) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
