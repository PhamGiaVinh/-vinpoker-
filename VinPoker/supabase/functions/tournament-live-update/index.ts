import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  reconcileSidePots,
  validateAction,
  type ActionRow,
  type PlayerSeed,
  type ProposedAction,
} from "../_shared/trackerEngine/index.ts";

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
        const { hand_id, player_id, entry_number, street, action_type, action_amount, action_order } = body;

        if (VALIDATION_MODE !== "off") {
          const loaded = await loadHandForValidation(hand_id);
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
              if (VALIDATION_MODE === "enforce") {
                return validationError(verdict.code, verdict.message);
              }
              // warn: record anyway, but surface the verdict for observability.
              validationNote = { code: verdict.code, message: verdict.message, normalizedAmount: verdict.normalizedAmount };
              console.warn(`[tracker-validation:warn] hand=${hand_id} player=${player_id} ${action_type} -> ${verdict.code}`);
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
    return new Response(JSON.stringify({ status: "success", data: result.data, ...(validationNote ? { validation: validationNote } : {}) }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});