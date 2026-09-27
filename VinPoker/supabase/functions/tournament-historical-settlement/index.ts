import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, jsonResp } from "../_shared/cors.ts";
import {
  HistoricalDisplayVerificationError,
  verifyHistoricalDisplaySettlement,
} from "../_shared/trackerSettlement/historicalDisplayVerification.ts";
import { canonicalJsonV1 } from "../_shared/trackerSettlement/outcomeV1.ts";
import { normalizeSettlementSourceRpcResult, type SettlementDbAction, type SettlementDbHand, type SettlementDbPlayer } from "../_shared/trackerSettlement/compute.ts";

type Body = {
  mode?: "preview" | "commit" | "correct_blinds";
  tournament_id?: string;
  hand_id?: string;
  idempotency_key?: string;
  expected_source_revision?: number;
  expected_source_chain_hash?: string;
  expected_outcome_hash?: string;
  blind_level_id?: string;
  correction_reason?: string;
  correction_evidence?: Record<string, unknown>;
};

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicFailure(req: Request, code: string, status = 409) {
  return jsonResp(req, { ok: false, code, message: "Historical display verification was not accepted" }, status);
}

function rpcFailureCode(error: { message?: string } | null): string {
  const allowed = new Set([
    "service_role_only",
    "idempotency_mismatch",
    "stale_source_revision",
    "historical_settlement_already_exists",
    "actor_not_authorized",
    "invalid_historical_hand",
    "historical_player_projection_mismatch",
    "blind_snapshot_already_present",
    "invalid_tournament_level_snapshot",
    "invalid_blind_correction_request",
    "stale_source_revision",
    "tracker_blind_snapshot_server_owned",
  ]);
  return error?.message && allowed.has(error.message) ? error.message : "historical_display_commit_rejected";
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return jsonResp(req, { ok: false, message: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return jsonResp(req, { ok: false, message: "Unauthorized" }, 401);

  try {
    const body = await req.json() as Body;
    const mode = body.mode;
    const tournamentId = text(body.tournament_id);
    const handId = text(body.hand_id);
    if ((mode !== "preview" && mode !== "commit" && mode !== "correct_blinds") || !tournamentId || !handId) {
      return jsonResp(req, { ok: false, message: "Invalid historical settlement intent" }, 400);
    }
    if (mode === "commit" && text(body.idempotency_key).length < 12) {
      return publicFailure(req, "invalid_idempotency_key", 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("historical_settlement_runtime_not_configured");

    const user = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: authData } = await user.auth.getUser();
    if (!authData.user) return jsonResp(req, { ok: false, message: "Unauthorized" }, 401);
    const { data: authorized, error: authorizationError } = await user.rpc("authorize_tournament_live_resettle", {
      p_tournament_id: tournamentId,
    });
    if (authorizationError || authorized !== true) return jsonResp(req, { ok: false, message: "Not authorized" }, 403);

    const service = createClient(url, serviceKey);
    if (mode === "correct_blinds") {
      if (!Number.isSafeInteger(body.expected_source_revision)
        || !text(body.blind_level_id) || text(body.correction_reason).length < 8
        || text(body.idempotency_key).length < 12
        || !body.correction_evidence || typeof body.correction_evidence !== "object") {
        return publicFailure(req, "invalid_blind_correction_request", 400);
      }
      const { data: correction, error: correctionError } = await service.rpc("correct_tracker_historical_hand_blinds", {
        p_hand_id: handId,
        p_actor_user_id: authData.user.id,
        p_expected_source_revision: body.expected_source_revision,
        p_level_id: text(body.blind_level_id),
        p_reason: text(body.correction_reason),
        p_idempotency_key: text(body.idempotency_key),
        p_evidence: body.correction_evidence,
      });
      if (correctionError) return publicFailure(req, rpcFailureCode(correctionError));
      return jsonResp(req, { ok: true, status: "corrected", hand_id: handId, receipt: correction });
    }
    const [{ data: hand, error: handError }, { data: players, error: playerError }, { data: actions, error: actionError }, { data: source, error: sourceError }, { data: priorOutcomes, error: priorOutcomeError }] = await Promise.all([
      service.from("tournament_hands")
        .select("id,tournament_id,hand_number,table_id,table_session_id,button_seat,community_cards,pot_size,side_pots,status,is_voided,updated_at,created_at,source_revision,tracker_level_id,tracker_level_number,tracker_small_blind,tracker_big_blind,tracker_bba,tracker_is_break,tracker_blind_evidence")
        .eq("id", handId)
        .eq("tournament_id", tournamentId)
        .maybeSingle(),
      service.from("hand_players")
        .select("hand_id,player_id,entry_number,seat_number,starting_stack,ending_stack,hole_cards,is_eliminated")
        .eq("hand_id", handId)
        .order("seat_number")
        .order("player_id")
        .order("entry_number"),
      service.from("hand_actions")
        .select("id,hand_id,player_id,entry_number,street,action_type,action_amount,action_order")
        .eq("hand_id", handId)
        .order("action_order")
        .order("id"),
      service.rpc("get_tournament_historical_display_source_hash", { p_hand_id: handId }),
      service.from("tournament_settlement_outcomes").select("settlement_revision")
        .eq("hand_id", handId).order("settlement_revision", { ascending: false }).limit(1),
    ]);
    if (handError || playerError || actionError || sourceError || priorOutcomeError) throw handError || playerError || actionError || sourceError || priorOutcomeError;
    if (!hand) return publicFailure(req, "historical_hand_not_found", 404);
    const settlementSource = normalizeSettlementSourceRpcResult(source);
    const result = await verifyHistoricalDisplaySettlement({
      tournamentId,
      hand: hand as SettlementDbHand,
      players: (players ?? []) as SettlementDbPlayer[],
      actions: (actions ?? []) as SettlementDbAction[],
      sourceRevision: settlementSource.sourceRevision,
      sourceChainHash: settlementSource.sourceChainHash,
      settlementRevision: Number(priorOutcomes?.[0]?.settlement_revision ?? 0) + 1,
      actor: { userId: authData.user.id, role: "club_owner_or_admin" },
    });

    const preview = {
      ok: true,
      status: "preview",
      hand_id: handId,
      source_revision: result.privateOutcome.sourceRevision,
      source_chain_hash: result.privateOutcome.sourceChainHash,
      outcome_hash: result.privateOutcome.outcomeHash,
      public_outcome: result.publicOutcome,
    };
    if (mode === "preview") return jsonResp(req, preview);

    if (body.expected_source_revision !== preview.source_revision
      || body.expected_source_chain_hash !== preview.source_chain_hash
      || body.expected_outcome_hash !== preview.outcome_hash) {
      return publicFailure(req, "stale_historical_preview");
    }

    const requestHash = await sha256Hex(canonicalJsonV1({
      contract: "historical-settlement-display-v1",
      tournamentId,
      handId,
      sourceRevision: preview.source_revision,
      sourceChainHash: preview.source_chain_hash,
      outcomeHash: preview.outcome_hash,
    }));
    const { data: receipt, error: commitError } = await service.rpc(
      "commit_tracker_historical_display_outcome_v2",
      {
        p_hand_id: handId,
        p_actor_user_id: authData.user.id,
        p_actor_kind: "owner_admin",
        p_expected_source_revision: preview.source_revision,
        p_expected_source_chain_hash: preview.source_chain_hash,
        p_outcome_hash: preview.outcome_hash,
        p_request_hash: requestHash,
        p_idempotency_key: text(body.idempotency_key),
        p_public_outcome: result.publicOutcome,
        p_lease_token: null,
      },
    );
    if (commitError) return publicFailure(req, rpcFailureCode(commitError));
    return jsonResp(req, { ok: true, status: "verified", hand_id: handId, receipt });
  } catch (error) {
    if (error instanceof HistoricalDisplayVerificationError) return publicFailure(req, error.code, 422);
    console.error("[tournament-historical-settlement] unexpected_request_failure");
    return jsonResp(req, { ok: false, message: "Historical display verification failed" }, 500);
  }
});
