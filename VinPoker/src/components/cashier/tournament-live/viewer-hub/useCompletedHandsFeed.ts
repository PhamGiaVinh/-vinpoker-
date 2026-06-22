// READ-ONLY data hook for the spectator HAND FEED. Queries COMPLETED, non-voided
// hands (paginated, newest-first — same shape HandSelector / the replay path use),
// batches hand_players / hand_actions / tournament_eliminations / profiles by hand
// id, and builds the feed view-models via the pure `handFeedDerive`. No writes, no
// new RPC/Edge/publication. Visibility-aware 13s poll on the loaded pages; mounted
// only when FEATURES.liveHandFeed is on, so a flag-OFF viewer pays zero extra reads.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildHandFeedItems,
  filterByTags,
  type HandFeedItem,
  type HandFeedTag,
  type RawElimination,
  type RawHandAction,
  type RawHandPlayer,
  type RawHandRow,
  type RawProfile,
} from "./handFeedDerive";

const PAGE_SIZE = 10;
const POLL_MS = 13_000;

export interface CompletedHandsFeedOptions {
  /** Restrict to one table (the viewer's featured table). null = all tables. */
  tableId?: string | null;
  /** Client-side tag filter (empty = no filter). */
  tags?: HandFeedTag[];
  bigPotThresholdBB?: number;
}

export interface CompletedHandsFeedData {
  items: HandFeedItem[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

function groupByHand<T extends { hand_id: string }>(rows: T[] | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows ?? []) {
    const arr = m.get(r.hand_id) ?? [];
    arr.push(r);
    m.set(r.hand_id, arr);
  }
  return m;
}

export function useCompletedHandsFeed(
  tournamentId: string | undefined,
  opts: CompletedHandsFeedOptions = {},
): CompletedHandsFeedData {
  const { tableId = null, tags = [], bigPotThresholdBB } = opts;
  const [pageCount, setPageCount] = useState(1);
  const [allItems, setAllItems] = useState<HandFeedItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const seqRef = useRef(0);

  // Reset paging when the tournament / table scope changes.
  useEffect(() => {
    setPageCount(1);
  }, [tournamentId, tableId]);

  const fetchFeed = useCallback(async () => {
    if (!tournamentId) {
      setAllItems([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    const want = pageCount * PAGE_SIZE;

    let q = supabase
      .from("tournament_hands")
      .select("id, hand_number, created_at, community_cards, pot_size, button_seat, table_id, status, is_voided")
      .eq("tournament_id", tournamentId)
      .eq("is_voided", false)
      .order("created_at", { ascending: false })
      .limit(want + 1);
    if (tableId) q = q.eq("table_id", tableId);
    const { data: handRows } = await q;
    if (seq !== seqRef.current) return;

    const completed = (handRows ?? []).filter((h: { status?: string }) => h.status !== "in_progress");
    const more = completed.length > want;
    const pageHands = completed.slice(0, want) as unknown as RawHandRow[];
    const ids = pageHands.map((h) => h.id);
    if (ids.length === 0) {
      setAllItems([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    const [{ data: hp }, { data: ha }, { data: el }] = await Promise.all([
      supabase
        .from("hand_players")
        .select("hand_id, player_id, seat_number, starting_stack, ending_stack, hole_cards, is_eliminated")
        .in("hand_id", ids),
      supabase
        .from("hand_actions")
        .select("hand_id, player_id, action_type, action_amount, action_order")
        .in("hand_id", ids)
        .order("action_order"),
      supabase
        .from("tournament_eliminations")
        .select("hand_id, player_id, position, prize")
        .in("hand_id", ids),
    ]);
    if (seq !== seqRef.current) return;

    const playerIds = [...new Set((hp ?? []).map((p: { player_id: string }) => p.player_id))];
    const { data: profs } = playerIds.length
      ? await supabase.from("profiles").select("user_id, display_name, avatar_url").in("user_id", playerIds)
      : { data: [] as RawProfile[] };
    if (seq !== seqRef.current) return;

    const profMap = new Map<string, RawProfile>();
    (profs ?? []).forEach((p: RawProfile) =>
      profMap.set(p.user_id, { user_id: p.user_id, display_name: p.display_name ?? null, avatar_url: p.avatar_url ?? null }),
    );

    const items = buildHandFeedItems(
      pageHands,
      groupByHand(hp as unknown as RawHandPlayer[] | null),
      groupByHand(ha as unknown as RawHandAction[] | null),
      groupByHand(el as unknown as RawElimination[] | null),
      profMap,
      { bigPotThresholdBB },
    );
    setAllItems(items);
    setHasMore(more);
    setLoading(false);
  }, [tournamentId, tableId, pageCount, bigPotThresholdBB]);

  useEffect(() => {
    setLoading(true);
    void fetchFeed();
  }, [fetchFeed]);

  // Visibility-aware poll: pause when the tab is hidden, refetch the loaded pages.
  useEffect(() => {
    if (!tournamentId || typeof document === "undefined") return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => void fetchFeed(), POLL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") stop();
      else {
        void fetchFeed();
        start();
      }
    };
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tournamentId, fetchFeed]);

  const loadMore = useCallback(() => setPageCount((c) => c + 1), []);
  const items = tags.length ? filterByTags(allItems, tags) : allItems;
  return { items, loading, hasMore, loadMore };
}
