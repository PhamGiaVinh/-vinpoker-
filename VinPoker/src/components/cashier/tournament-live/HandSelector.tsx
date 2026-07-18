// Completed-hand picker for replay mode. Reuses the same read-only query shape
// the live viewer / HandHistoryPanel already use (no new RPC, no backend
// change). On select it loads the full hand (actions + players + profiles) and
// hands a ReplayHand to the parent.

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, History } from "lucide-react";
import type { ReplayHand } from "@/lib/tracker-poker/replayEngine";
import { fetchHandPlayerDisplay, handPlayersHasSnapshot } from "@/lib/tracker-poker/handPlayerNames";
import type { ReplayTarget, ReplayTargetState } from "./viewer-hub/replayTarget";

interface HandRow {
  id: string;
  hand_number: number;
  created_at: string;
  community_cards: string[] | null;
  button_seat: number | null;
  pot_size: number | null;
}

interface HandSelectorProps {
  tournamentId: string;
  /** When set, only hands on this table are offered (never mix tables). */
  tableId: string | null;
  selectedHandId: string | null;
  /** Clear the previous replay frame before an async hand load begins. */
  onLoadStart?: (handId: string) => void;
  onSelectHand: (handId: string, hand: ReplayHand) => void;
  /** URL target. When supplied, this selector never substitutes another hand. */
  replayTarget?: ReplayTarget | null;
  /** Parent resolution protects table selection; selector renders its exact state. */
  replayTargetState?: ReplayTargetState;
}

export function HandSelector({
  tournamentId,
  tableId,
  selectedHandId,
  onLoadStart,
  onSelectHand,
  replayTarget = null,
  replayTargetState = { kind: "idle" },
}: HandSelectorProps) {
  const [hands, setHands] = useState<HandRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingHand, setLoadingHand] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    setListError(null);
    (async () => {
      let q = supabase
        .from("tournament_hands")
        .select("id, hand_number, created_at, community_cards, button_seat, pot_size, status, is_voided, table_id")
        .eq("tournament_id", tournamentId)
        .eq("is_voided", false)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(50);
      if (tableId) q = q.eq("table_id", tableId);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        setHands([]);
        setListError(error.message || "Không thể tải lịch sử ván.");
        setLoadingList(false);
        return;
      }
      const rows = (data ?? [])
        .filter((h: any) => h.status !== "in_progress")
        .map((h: any) => ({
          id: h.id,
          hand_number: h.hand_number,
          created_at: h.created_at,
          community_cards: h.community_cards,
          button_seat: h.button_seat,
          pot_size: h.pot_size,
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
      const generation = ++loadGenerationRef.current;
      const isCurrentLoad = () => loadGenerationRef.current === generation;
      onLoadStart?.(row.id);
      setLoadingHand(true);
      setLoadError(null);
      try {
        // E1: prefer the per-hand snapshot (hand_players.player_name/avatar_url) when the
        // migration is applied; the columns are selected only if present (feature-detect).
        const snap = await handPlayersHasSnapshot();
        const hpCols = snap
          ? "player_id, seat_number, starting_stack, ending_stack, hole_cards, player_name, avatar_url"
          : "player_id, seat_number, starting_stack, ending_stack, hole_cards";
        const [{ data: actionData, error: actionError }, { data: handPlayers, error: handPlayersError }] = await Promise.all([
          supabase
            .from("hand_actions")
            .select("id, player_id, street, action_type, action_amount, action_order")
            .eq("hand_id", row.id)
            .order("action_order"),
          supabase.from("hand_players").select(hpCols).eq("hand_id", row.id),
        ]);
        if (!isCurrentLoad()) return;
        if (actionError || handPlayersError) {
          setLoadError(actionError?.message || handPlayersError?.message || "Không thể tải dữ liệu replay.");
          return;
        }

        // Fall back to the live tournament_seats roster ONLY for rows the snapshot didn't
        // capture (old hands) — the helper no-ops on an empty id list, so this is free
        // once every hand is snapshotted.
        const needIds = (handPlayers ?? []).filter((p: any) => !p.player_name).map((p: any) => p.player_id);
        const display = await fetchHandPlayerDisplay(tournamentId, needIds);
        if (!isCurrentLoad()) return;

        const hand: ReplayHand = {
          hand_id: row.id,
          hand_number: row.hand_number,
          button_seat: row.button_seat || 1,
          community_cards: (row.community_cards as string[]) || [],
          stored_pot_size: row.pot_size,
          players: (handPlayers ?? []).map((p: any) => ({
            player_id: p.player_id,
            seat_number: p.seat_number,
            display_name: p.player_name || display.get(p.player_id)?.name || p.player_id.slice(0, 6),
            starting_stack: p.starting_stack ?? 0,
            ending_stack: p.ending_stack ?? null,
            avatar_url: p.avatar_url ?? display.get(p.player_id)?.avatar ?? null,
            hole_cards:
              p.hole_cards && (p.hole_cards as string[]).length > 0
                ? (p.hole_cards as string[])
                : undefined,
          })),
          actions: (actionData ?? []).map((a: any) => ({
            action_id: a.id,
            player_id: a.player_id,
            street: a.street || "preflop",
            action_type: a.action_type,
            action_amount: a.action_amount ?? 0,
            action_order: a.action_order,
          })),
        };
        onSelectHand(row.id, hand);
      } catch (cause) {
        if (!isCurrentLoad()) return;
        setLoadError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu replay.");
      } finally {
        if (isCurrentLoad()) setLoadingHand(false);
      }
    },
    [onLoadStart, onSelectHand, tournamentId]
  );

  useEffect(() => () => {
    loadGenerationRef.current += 1;
  }, []);

  // A target is never allowed to fall back to `hands[0]`. When it is outside the
  // first page, load the exact UUID in the same tournament scope instead.
  useEffect(() => {
    let cancelled = false;
    if (replayTarget) {
      if (replayTargetState.kind !== "resolved" || selectedHandId === replayTargetState.handId) return;
      const listed = hands.find((hand) => hand.id === replayTargetState.handId);
      if (listed) {
        void loadHand(listed);
        return;
      }

      void (async () => {
        const { data, error } = await supabase
          .from("tournament_hands")
          .select("id, hand_number, created_at, community_cards, button_seat, pot_size, status, is_voided")
          .eq("tournament_id", tournamentId)
          .eq("id", replayTargetState.handId)
          .eq("is_voided", false)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data || data.status === "in_progress") {
          setLoadError(error?.message || "Không tìm thấy hand được yêu cầu.");
          return;
        }
        void loadHand(data as HandRow);
      })();
      return () => { cancelled = true; };
    }

    if (hands.length > 0 && !selectedHandId) void loadHand(hands[0]);
    return () => { cancelled = true; };
  }, [hands, loadHand, replayTarget, replayTargetState, selectedHandId, tournamentId]);

  const targetMessage: Record<Exclude<ReplayTargetState["kind"], "idle" | "resolved">, string> = {
    loading: "Đang tìm hand từ đường dẫn...",
    not_found: "Không tìm thấy hand trong giải này.",
    ambiguous: "Số hand cũ trùng ở nhiều bàn. Hãy mở link có handId.",
    mismatch: "Hand và table trong đường dẫn không khớp.",
    query_error: "Không thể truy vấn hand. Hãy thử lại.",
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <History className="w-3.5 h-3.5" /> Hand:
      </span>
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-xs min-w-[140px]"
        value={selectedHandId ?? ""}
        disabled={loadingList || !!listError || hands.length === 0}
        onChange={(e) => {
          const row = hands.find((h) => h.id === e.target.value);
          if (row) void loadHand(row);
        }}
      >
        {loadingList && <option value="">Đang tải...</option>}
        {!loadingList && listError && <option value="">Không tải được lịch sử hand</option>}
        {!loadingList && !listError && hands.length === 0 && <option value="">Chưa có hand đã xong</option>}
        {hands.map((h) => (
          <option key={h.id} value={h.id}>
            Hand #{h.hand_number}
          </option>
        ))}
      </select>
      {loadingHand && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />}
      {replayTargetState.kind !== "idle" && replayTargetState.kind !== "resolved" && (
        <p role="status" className="w-full text-xs text-warning">{targetMessage[replayTargetState.kind]}</p>
      )}
      {listError && <p role="alert" className="w-full text-xs text-destructive">{listError}</p>}
      {loadError && <p role="alert" className="w-full text-xs text-destructive">{loadError}</p>}
    </div>
  );
}
