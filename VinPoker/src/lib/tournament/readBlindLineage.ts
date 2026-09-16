import { supabase } from "@/integrations/supabase/client";

export interface RecordedBlindLineage {
  previousDealtSeats: number[];
  previousButtonSeat: number;
  previousSbPosition: number;
  previousBbSeat: number;
}

/** Read a completed hand's blind evidence, including pre-migration blind posts. */
export async function readBlindLineage(handId: string): Promise<RecordedBlindLineage | null> {
  const [handResult, actionResult, playerResult] = await Promise.all([
    supabase.from("tournament_hands")
      .select("button_seat,status,is_voided,tracker_sb_position,tracker_bb_position")
      .eq("id", handId).maybeSingle(),
    supabase.from("hand_actions")
      .select("player_id,entry_number,action_type")
      .eq("hand_id", handId).in("action_type", ["post_sb", "post_bb"]),
    supabase.from("hand_players")
      .select("player_id,entry_number,seat_number")
      .eq("hand_id", handId),
  ]);
  if (handResult.error || actionResult.error || playerResult.error || !handResult.data) return null;
  const hand = handResult.data as unknown as {
    button_seat: number | null;
    status: string;
    is_voided: boolean | null;
    tracker_sb_position: number | null;
    tracker_bb_position: number | null;
  };
  if (hand.status !== "completed" || hand.is_voided) return null;
  const posts = actionResult.data ?? [];
  const players = playerResult.data ?? [];
  const previousDealtSeats = [...new Set(players.map((player) => player.seat_number))].sort((left, right) => left - right);
  const postedSeat = (type: "post_sb" | "post_bb"): number | null => {
    const matched = posts.filter((action) => action.action_type === type);
    if (matched.length !== 1) return null;
    const player = players.find((row) => row.player_id === matched[0].player_id
      && row.entry_number === matched[0].entry_number);
    return player?.seat_number ?? null;
  };
  const postedSb = postedSeat("post_sb");
  const postedBb = postedSeat("post_bb");
  const sb = hand.tracker_sb_position ?? postedSb;
  const bb = hand.tracker_bb_position ?? postedBb;
  if (postedSb !== null && sb !== postedSb) return null;
  if (postedBb !== null && bb !== postedBb) return null;
  if (hand.button_seat == null || sb == null || bb == null || postedBb == null
    || previousDealtSeats.length < 2 || !previousDealtSeats.includes(bb)) return null;
  return { previousDealtSeats, previousButtonSeat: hand.button_seat, previousSbPosition: sb, previousBbSeat: bb };
}
