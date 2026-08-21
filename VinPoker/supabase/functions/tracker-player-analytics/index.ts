import { createClient } from "npm:@supabase/supabase-js@2.105.4";

import { corsHeaders, handleOptions, jsonResp } from "../_shared/cors.ts";
import { retryFetch } from "../_shared/retry.ts";
import {
  classifyTrackerPlayerAnalytics,
  type TrackerAnalyticsHand,
  type TrackerAnalyticsSettlementProof,
} from "../_shared/trackerPlayerAnalytics.ts";
import type { ActionRow, PlayerSeed } from "../_shared/trackerEngine/types.ts";

const MAX_REQUEST_BYTES = 4_096;
const MAX_HANDS = 500;
const ALLOWED_DAYS = new Set([0, 30, 90, 365]);

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function boardCardCount(value: unknown): number {
  if (Array.isArray(value)) return value.filter((card) => typeof card === "string" && card.length > 0).length;
  if (typeof value !== "string") return 0;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function settlementProof(value: unknown): TrackerAnalyticsSettlementProof | null {
  if (!value || typeof value !== "object") return null;
  const outcome = value as Record<string, unknown>;
  if (outcome.status !== "verified" || !Array.isArray(outcome.pots)) return null;
  const winners = new Set<string>();
  const eligible = new Set<string>();
  for (const rawPot of outcome.pots) {
    if (!rawPot || typeof rawPot !== "object") return null;
    const pot = rawPot as Record<string, unknown>;
    if (!Array.isArray(pot.winnerIds) || !Array.isArray(pot.eligiblePlayerIds)) return null;
    for (const id of pot.winnerIds) if (typeof id === "string") winners.add(id);
    for (const id of pot.eligiblePlayerIds) if (typeof id === "string") eligible.add(id);
  }
  const handRanks = Array.isArray(outcome.handRanks) ? outcome.handRanks : [];
  return {
    verified: true,
    current: true,
    winnerPlayerIds: [...winners],
    eligiblePlayerIds: [...eligible],
    showdown: handRanks.length > 0 && eligible.size >= 2,
  };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResp(req, { error: "METHOD_NOT_ALLOWED" }, 405);
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return jsonResp(req, { error: "REQUEST_TOO_LARGE" }, 413);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return jsonResp(req, { error: "MISCONFIGURED" }, 500);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResp(req, { error: "UNAUTHORIZED" }, 401);

  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return jsonResp(req, { error: "REQUEST_TOO_LARGE" }, 413);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResp(req, { error: "INVALID_JSON" }, 400);
    }
    const tournamentId = body.tournament_id;
    const playerId = body.player_id;
    const days = typeof body.days === "number" ? body.days : 90;
    if (!isUuid(tournamentId) || !isUuid(playerId) || !ALLOWED_DAYS.has(days)) {
      return jsonResp(req, { error: "INVALID_REQUEST" }, 400);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader }, fetch: retryFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user?.id) return jsonResp(req, { error: "UNAUTHORIZED" }, 401);
    const { data: authorizationData, error: authorizationError } = await userClient.rpc(
      "authorize_tracker_player_analytics",
      { p_tournament_id: tournamentId, p_player_id: playerId },
    );
    const authorization = authorizationData as Record<string, unknown> | null;
    if (authorizationError || authorization?.ok !== true) {
      return jsonResp(req, {
        error: typeof authorization?.error === "string" ? authorization.error : "ACTOR_NOT_ALLOWED",
      }, 403);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      global: { fetch: retryFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let handQuery = admin
      .from("tournament_hands")
      .select("id,status,is_voided,button_seat,community_cards,source_revision,hand_time")
      .eq("tournament_id", tournamentId)
      .eq("status", "completed")
      .order("hand_time", { ascending: false })
      .limit(MAX_HANDS + 1);
    if (days > 0) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      handQuery = handQuery.gte("hand_time", since);
    }
    const { data: rawHands, error: handsError } = await handQuery;
    if (handsError) throw new Error(handsError.message);
    const truncated = (rawHands?.length ?? 0) > MAX_HANDS;
    const hands = (rawHands ?? []).slice(0, MAX_HANDS);
    const handIds = hands.map((hand) => hand.id);
    if (handIds.length === 0) {
      return jsonResp(req, {
        ok: true,
        player: {
          id: playerId,
          name: authorization.player_name,
          avatar_url: authorization.avatar_url,
        },
        tournament_id: tournamentId,
        days,
        truncated: false,
        analytics: classifyTrackerPlayerAnalytics(playerId, []),
      });
    }

    const [{ data: rawPlayers, error: playersError }, { data: rawActions, error: actionsError }, { data: rawOutcomes, error: outcomesError }] = await Promise.all([
      admin.from("hand_players").select("hand_id,player_id,seat_number,starting_stack").in("hand_id", handIds),
      admin.from("hand_actions").select("hand_id,player_id,street,action_type,action_amount,action_order").in("hand_id", handIds).order("action_order"),
      admin.from("tournament_settlement_outcomes").select("hand_id,source_revision,settlement_revision,status,public_outcome").in("hand_id", handIds).eq("status", "verified").order("settlement_revision", { ascending: false }),
    ]);
    if (playersError || actionsError || outcomesError) {
      throw new Error(playersError?.message ?? actionsError?.message ?? outcomesError?.message ?? "analytics_read_failed");
    }

    const latestOutcomes = new Map<string, Record<string, unknown>>();
    for (const row of rawOutcomes ?? []) {
      if (!latestOutcomes.has(row.hand_id)) latestOutcomes.set(row.hand_id, row as Record<string, unknown>);
    }
    const analyticsHands: TrackerAnalyticsHand[] = hands.map((rawHand) => {
      const seeds = (rawPlayers ?? [])
        .filter((row) => row.hand_id === rawHand.id)
        .map((row) => ({
          player_id: row.player_id,
          seat_number: row.seat_number,
          starting_stack: row.starting_stack ?? 0,
        })) as PlayerSeed[];
      const actions = (rawActions ?? [])
        .filter((row) => row.hand_id === rawHand.id)
        .map((row) => ({
          player_id: row.player_id,
          street: row.street ?? "preflop",
          action_type: row.action_type,
          action_amount: row.action_amount ?? 0,
          action_order: row.action_order,
        })) as ActionRow[];
      const outcomeRow = latestOutcomes.get(rawHand.id);
      const isCurrent = Number(outcomeRow?.source_revision) === Number(rawHand.source_revision);
      return {
        handId: rawHand.id,
        status: rawHand.status,
        isVoided: rawHand.is_voided ?? false,
        buttonSeat: rawHand.button_seat ?? 1,
        boardCardCount: boardCardCount(rawHand.community_cards),
        players: seeds,
        actions,
        settlement: isCurrent ? settlementProof(outcomeRow?.public_outcome) : null,
      };
    });

    return jsonResp(req, {
      ok: true,
      player: {
        id: playerId,
        name: authorization.player_name,
        avatar_url: authorization.avatar_url,
      },
      tournament_id: tournamentId,
      days,
      truncated,
      analytics: classifyTrackerPlayerAnalytics(playerId, analyticsHands),
    });
  } catch {
    return jsonResp(req, { error: "ANALYTICS_UNAVAILABLE" }, 500);
  }
});
