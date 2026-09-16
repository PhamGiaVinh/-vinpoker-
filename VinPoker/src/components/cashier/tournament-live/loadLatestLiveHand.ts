import { supabase } from "@/integrations/supabase/client";

/** Select before LIMIT: a table with no hand must never inherit another table's hand. */
export function loadLatestLiveHand(tournamentId: string, tableId: string | null) {
  let query = supabase.from("tournament_hands")
    .select("id, hand_number, community_cards, pot_size, is_voided, status, button_seat, table_id, tracker_big_blind, tracker_small_blind, tracker_level_number, tracker_bba")
    .eq("tournament_id", tournamentId)
    .eq("is_voided", false);
  if (tableId) query = query.eq("table_id", tableId);
  return query.order("created_at", { ascending: false }).limit(1);
}
