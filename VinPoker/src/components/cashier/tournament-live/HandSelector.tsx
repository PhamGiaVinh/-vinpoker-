// Completed-hand picker for replay mode. Reuses the same read-only query shape
// the live viewer / HandHistoryPanel already use (no new RPC, no backend
// change). On select it loads the full hand (actions + players + profiles) and
// hands a ReplayHand to the parent.

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, History } from "lucide-react";
import type { ReplayHand } from "@/lib/tracker-poker/replayEngine";
import { fetchHandPlayerDisplay } from "@/lib/tracker-poker/handPlayerNames";

interface HandRow {
  id: string;
  hand_number: number;
  created_at: string;
  community_cards: string[] | null;
  button_seat: number | null;
}

interface HandSelectorProps {
  tournamentId: string;
  /** When set, only hands on this table are offered (never mix tables). */
  tableId: string | null;
  selectedHandId: string | null;
  onSelectHand: (handId: string, hand: ReplayHand) => void;
  /** Deep-link: when set, select this hand number instead of the most recent one
   *  (ADDITIVE — omit/null keeps the auto-select-most-recent behaviour). */
  initialHandNumber?: number | null;
}

export function HandSelector({
  tournamentId,
  tableId,
  selectedHandId,
  onSelectHand,
  initialHandNumber = null,
}: HandSelectorProps) {
  const [hands, setHands] = useState<HandRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingHand, setLoadingHand] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    (async () => {
      let q = supabase
        .from("tournament_hands")
        .select("id, hand_number, created_at, community_cards, button_seat, status, is_voided, table_id")
        .eq("tournament_id", tournamentId)
        .eq("is_voided", false)
        .order("created_at", { ascending: false })
        .limit(50);
      if (tableId) q = q.eq("table_id", tableId);
      const { data } = await q;
      if (cancelled) return;
      const rows = (data ?? [])
        .filter((h: any) => h.status !== "in_progress")
        .map((h: any) => ({
          id: h.id,
          hand_number: h.hand_number,
          created_at: h.created_at,
          community_cards: h.community_cards,
          button_seat: h.button_seat,
        }));
      setHands(rows);
      setLoadingList(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tournamentId, tableId]);

  const loadHand = useCallback(
    async (row: HandRow) => {
      setLoadingHand(true);
      try {
        const [{ data: actionData }, { data: handPlayers }] = await Promise.all([
          supabase
            .from("hand_actions")
            .select("player_id, street, action_type, action_amount, action_order")
            .eq("hand_id", row.id)
            .order("action_order"),
          supabase
            .from("hand_players")
            .select("player_id, seat_number, starting_stack, ending_stack, hole_cards")
            .eq("hand_id", row.id),
        ]);

        const playerIds = [...new Set((handPlayers ?? []).map((p: any) => p.player_id))];
        // Names + avatars come from tournament_seats.player_name / avatar_url keyed by
        // player_id — the SAME source LIVE uses. The old profiles.user_id join always
        // missed (player_id is a tournament-entry id, not an auth user_id) → showed the
        // raw short id.
        const display = await fetchHandPlayerDisplay(tournamentId, playerIds);

        const hand: ReplayHand = {
          hand_number: row.hand_number,
          button_seat: row.button_seat || 1,
          community_cards: (row.community_cards as string[]) || [],
          players: (handPlayers ?? []).map((p: any) => ({
            player_id: p.player_id,
            seat_number: p.seat_number,
            display_name: display.get(p.player_id)?.name || p.player_id.slice(0, 6),
            starting_stack: p.starting_stack ?? 0,
            ending_stack: p.ending_stack ?? null,
            avatar_url: display.get(p.player_id)?.avatar ?? null,
            hole_cards:
              p.hole_cards && (p.hole_cards as string[]).length > 0
                ? (p.hole_cards as string[])
                : undefined,
          })),
          actions: (actionData ?? []).map((a: any) => ({
            player_id: a.player_id,
            street: a.street || "preflop",
            action_type: a.action_type,
            action_amount: a.action_amount ?? 0,
            action_order: a.action_order,
          })),
        };
        onSelectHand(row.id, hand);
      } finally {
        setLoadingHand(false);
      }
    },
    [onSelectHand, tournamentId]
  );

  // Select the deep-linked hand if given, else auto-select the most recent once the
  // list loads.
  useEffect(() => {
    if (hands.length === 0) return;
    if (initialHandNumber != null) {
      const target = hands.find((h) => h.hand_number === initialHandNumber);
      if (target && target.id !== selectedHandId) {
        void loadHand(target);
        return;
      }
    }
    if (!selectedHandId) void loadHand(hands[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hands, initialHandNumber]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <History className="w-3.5 h-3.5" /> Hand:
      </span>
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-xs min-w-[140px]"
        value={selectedHandId ?? ""}
        disabled={loadingList || hands.length === 0}
        onChange={(e) => {
          const row = hands.find((h) => h.id === e.target.value);
          if (row) void loadHand(row);
        }}
      >
        {loadingList && <option value="">Đang tải...</option>}
        {!loadingList && hands.length === 0 && <option value="">Chưa có hand đã xong</option>}
        {hands.map((h) => (
          <option key={h.id} value={h.id}>
            Hand #{h.hand_number}
          </option>
        ))}
      </select>
      {loadingHand && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />}
    </div>
  );
}
