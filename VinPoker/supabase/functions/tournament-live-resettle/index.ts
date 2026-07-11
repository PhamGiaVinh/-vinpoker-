import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computePotBreakdown, contributionsFromActions } from "../_shared/trackerEngine/index.ts";
import { compareRankVec, evaluateBest, type Card } from "../_shared/pokerEngine/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const chips = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

type Player = { hand_id: string; player_id: string; entry_number: number; seat_number: number; starting_stack: number; ending_stack: number; hole_cards: string[] | null };
type Action = { hand_id: string; player_id: string; entry_number: number; street: string; action_type: string; action_amount: number; action_order: number };
type Hand = { id: string; hand_number: number; table_id: string; button_seat: number; community_cards: string[] | null; pot_size: number | null; side_pots: unknown; updated_at: string | null; created_at: string };

function clockwise(players: Player[], button: number): Player[] {
  return [...players].sort((a, b) => {
    const da = (a.seat_number - button + 99) % 99;
    const db = (b.seat_number - button + 99) % 99;
    return da - db;
  });
}

function settleTarget(hand: Hand, players: Player[], actions: Action[], board: string[]) {
  const contributions = contributionsFromActions(actions);
  const byContribution = new Map(contributions.map((row) => [row.player_id, row]));
  const breakdown = computePotBreakdown(contributions);
  const awards = new Map<string, number>();
  const folded = new Set(contributions.filter((row) => row.is_folded).map((row) => row.player_id));
  const live = players.filter((player) => !folded.has(player.player_id));
  const winnerIds = new Set<string>();

  for (const layer of breakdown.pots) {
    const eligible = live.filter((player) => layer.eligible_player_ids.includes(player.player_id));
    if (eligible.length === 0) throw new Error("pot_has_no_eligible_player");
    let winners: Player[];
    if (eligible.length === 1) {
      winners = eligible;
    } else {
      if (board.length !== 5 || eligible.some((player) => (player.hole_cards ?? []).length !== 2)) throw new Error("incomplete_showdown_cards");
      const ranked = eligible.map((player) => ({ player, rank: evaluateBest([...(player.hole_cards as string[]), ...board] as Card[]).rankVec }));
      const best = ranked.reduce((value, item) => compareRankVec(item.rank, value) > 0 ? item.rank : value, ranked[0].rank);
      winners = ranked.filter((item) => compareRankVec(item.rank, best) === 0).map((item) => item.player);
    }
    const ordered = clockwise(winners, hand.button_seat);
    const share = Math.floor(layer.amount / ordered.length);
    let odd = layer.amount - share * ordered.length;
    for (const winner of ordered) {
      awards.set(winner.player_id, (awards.get(winner.player_id) ?? 0) + share + (odd-- > 0 ? 1 : 0));
      winnerIds.add(winner.player_id);
    }
  }
  if (breakdown.uncalled) awards.set(breakdown.uncalled.player_id, (awards.get(breakdown.uncalled.player_id) ?? 0) + breakdown.uncalled.amount);

  const ending = new Map<string, number>();
  for (const player of players) {
    const committed = byContribution.get(player.player_id)?.total_bet ?? 0;
    if (committed > chips(player.starting_stack)) throw new Error("target_action_exceeds_stack");
    ending.set(player.player_id, chips(player.starting_stack) - committed + (awards.get(player.player_id) ?? 0));
  }
  const before = players.reduce((sum, player) => sum + chips(player.starting_stack), 0);
  const after = [...ending.values()].reduce((sum, value) => sum + value, 0);
  if (before !== after) throw new Error("target_not_conserved");
  return { ending, winnerIds: [...winnerIds], breakdown };
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, message: "Unauthorized" }, 401);

  try {
    const body = await req.json();
    const { tournament_id, hand_id, reason, edit, idempotency_key } = body ?? {};
    if (!tournament_id || !hand_id || !idempotency_key || typeof reason !== "string" || reason.trim().length < 3) return json({ ok: false, message: "Invalid resettle intent" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ ok: false, message: "Unauthorized" }, 401);
    const { data: authorized, error: authError } = await userClient.rpc("authorize_tournament_live_resettle", { p_tournament_id: tournament_id });
    if (authError || authorized !== true) return json({ ok: false, message: "Not authorized" }, 403);

    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: hands, error: handsError } = await service.from("tournament_hands")
      .select("id,hand_number,table_id,button_seat,community_cards,pot_size,side_pots,updated_at,created_at,status,is_voided")
      .eq("tournament_id", tournament_id).eq("is_voided", false).neq("status", "in_progress").order("created_at");
    if (handsError) throw handsError;
    const allHands = (hands ?? []) as Hand[];
    const targetIndex = allHands.findIndex((hand) => hand.id === hand_id);
    if (targetIndex < 0) return json({ ok: false, message: "Target hand not found" }, 404);
    const chain = allHands.slice(targetIndex);
    const ids = chain.map((hand) => hand.id);
    const [{ data: playerRows, error: playerError }, { data: actionRows, error: actionError }, { count: eliminationCount, error: eliminationError }] = await Promise.all([
      service.from("hand_players").select("hand_id,player_id,entry_number,seat_number,starting_stack,ending_stack,hole_cards").in("hand_id", ids),
      service.from("hand_actions").select("hand_id,player_id,entry_number,street,action_type,action_amount,action_order").in("hand_id", ids).order("action_order"),
      service.from("tournament_eliminations").select("id", { count: "exact", head: true }).eq("tournament_id", tournament_id),
    ]);
    if (playerError || actionError || eliminationError) throw playerError || actionError || eliminationError;

    const players = (playerRows ?? []) as Player[];
    const actions = (actionRows ?? []) as Action[];
    const target = chain[0];
    const targetPlayers = players.filter((player) => player.hand_id === target.id).map((player) => ({ ...player }));
    const originalTargetActions = actions.filter((action) => action.hand_id === target.id);
    const editedActions = Array.isArray(edit?.p_actions) ? edit.p_actions.map((action: Action) => ({ ...action, hand_id: target.id })) : originalTargetActions;
    const board = Array.isArray(edit?.p_community_cards) ? edit.p_community_cards : (target.community_cards ?? []);
    if (Array.isArray(edit?.p_hole_cards)) {
      const holes = new Map<string, string[]>(edit.p_hole_cards.map((row: { player_id: string; entry_number?: number; hole_cards: string[] }) => [`${row.player_id}:${row.entry_number ?? 1}`, row.hole_cards]));
      targetPlayers.forEach((player) => {
        const nextHoleCards = holes.get(`${player.player_id}:${player.entry_number}`);
        if (nextHoleCards) player.hole_cards = nextHoleCards;
      });
    }

    const entriesByPlayer = new Map<string, number>();
    for (const player of players) {
      const previous = entriesByPlayer.get(player.player_id);
      if (previous != null && previous !== player.entry_number) return json({ ok: false, message: "Chuỗi có tái nhập; không thể tự tính lại." }, 409);
      entriesByPlayer.set(player.player_id, player.entry_number);
    }

    const settlement = settleTarget(target, targetPlayers, editedActions, board);
    const carry = new Map<string, number>();
    const lastOld = new Map<string, number>();
    const lastNew = new Map<string, number>();
    const handChanges: any[] = [];

    for (const player of targetPlayers) {
      const nextEnd = settlement.ending.get(player.player_id)!;
      if ((chips(player.ending_stack) === 0) !== (nextEnd === 0)) return json({ ok: false, message: "Kết quả làm thay đổi trạng thái bust; phải dùng void." }, 409);
      carry.set(player.player_id, nextEnd); lastOld.set(player.player_id, chips(player.ending_stack)); lastNew.set(player.player_id, nextEnd);
      if (chips(player.ending_stack) !== nextEnd) handChanges.push({ hand_id: target.id, player_id: player.player_id, entry_number: player.entry_number, starting_stack: chips(player.starting_stack), ending_stack: nextEnd });
    }

    for (const later of chain.slice(1)) {
      const laterPlayers = players.filter((player) => player.hand_id === later.id);
      const laterActions = actions.filter((action) => action.hand_id === later.id);
      const contributions = new Map(contributionsFromActions(laterActions).map((row) => [row.player_id, row.total_bet]));
      for (const player of laterPlayers) {
        const oldStart = chips(player.starting_stack); const oldEnd = chips(player.ending_stack);
        const newStart = carry.get(player.player_id) ?? oldStart;
        const committed = contributions.get(player.player_id) ?? 0;
        if (committed > newStart) return json({ ok: false, message: `Chuỗi lệch tại ván #${later.hand_number}: stack không đủ cho action đã ghi.` }, 409);
        if (newStart !== oldStart && laterActions.some((action) => action.player_id === player.player_id && action.action_type === "all_in")) return json({ ok: false, message: `Chuỗi lệch tại ván #${later.hand_number}: all-in cap thay đổi.` }, 409);
        const newEnd = newStart + (oldEnd - oldStart);
        if (newEnd < 0 || (oldEnd === 0) !== (newEnd === 0)) return json({ ok: false, message: `Chuỗi lệch trạng thái tại ván #${later.hand_number}.` }, 409);
        carry.set(player.player_id, newEnd); lastOld.set(player.player_id, oldEnd); lastNew.set(player.player_id, newEnd);
        if (newStart !== oldStart || newEnd !== oldEnd) handChanges.push({ hand_id: later.id, player_id: player.player_id, entry_number: player.entry_number, starting_stack: newStart, ending_stack: newEnd });
      }
    }

    const changedIds = [...new Set(handChanges.map((change) => change.player_id))];
    const { data: liveStacks, error: liveError } = await service.from("tournament_chip_counts").select("player_id,entry_number,chip_count").eq("tournament_id", tournament_id).in("player_id", changedIds);
    if (liveError) throw liveError;
    const finalStacks = (liveStacks ?? []).map((row: any) => ({
      player_id: row.player_id, entry_number: row.entry_number, expected_current: chips(row.chip_count),
      chip_count: chips(row.chip_count) + (lastNew.get(row.player_id)! - lastOld.get(row.player_id)!),
    }));
    if (finalStacks.some((row) => row.chip_count < 0) || finalStacks.reduce((sum, row) => sum + row.chip_count - row.expected_current, 0) !== 0) return json({ ok: false, message: "Chip conservation failed" }, 409);

    const commitEdit: Record<string, unknown> = { reason: reason.trim() };
    if (Array.isArray(edit?.p_community_cards)) commitEdit.community_cards = board;
    if (Array.isArray(edit?.p_hole_cards)) commitEdit.hole_cards = edit.p_hole_cards;
    if (Array.isArray(edit?.p_actions)) commitEdit.actions = edit.p_actions;
    if (edit?.p_pot_size != null) commitEdit.pot_size = settlement.breakdown.totalPot;
    if (edit?.p_side_pots != null) commitEdit.side_pots = settlement.breakdown.pots;
    const requestHash = await sha256({ tournament_id, hand_id, reason, edit });
    const { data: result, error: commitError } = await service.rpc("commit_tournament_live_resettle", {
      p_tournament_id: tournament_id, p_hand_id: hand_id, p_actor_user_id: user.id,
      p_idempotency_key: idempotency_key, p_request_hash: requestHash,
      p_expected_hand_updated_at: target.updated_at, p_expected_elimination_count: eliminationCount ?? 0,
      p_edit: commitEdit, p_hand_changes: handChanges, p_final_stacks: finalStacks, p_winner_ids: settlement.winnerIds,
    });
    if (commitError) throw commitError;
    return json(result);
  } catch (error) {
    console.error("[tournament-live-resettle]", error instanceof Error ? error.message : "unknown_error");
    return json({ ok: false, message: error instanceof Error ? error.message : "Atomic resettle failed" }, 500);
  }
});
