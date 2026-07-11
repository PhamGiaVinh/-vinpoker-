// Thin, ISOLATED data hook for the public Live Poker Event Hub (Increment B).
//
// Powers the hub's lightweight overview pieces — live-table count, all-tables
// strip, and the "Cập nhật • Trực tiếp" feed — derived (via ./hubDerive) from the
// SAME tables the public viewer already reads (tournament_seats /
// tournament_hands / hand_actions). It is deliberately SEPARATE from
// TournamentLiveView (NOT extracted from it) so the shared operator viewer stays
// byte-identical — the only cost is a light extra read on a gentle poll. No new
// realtime channel, no publication change, no RPC writes, no DB writes.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import {
  activeSeats,
  deriveBubbleItm,
  deriveChipLeader,
  deriveEliminations,
  deriveFeed,
  deriveMilestones,
  deriveTables,
  type HubChipLeader,
  type HubFeedItem,
  type HubStoryItem,
  type HubTableSummary,
  type RawAction,
  type RawHandPlayer,
  type RawSeat,
} from "./hubDerive";

export type { HubTableSummary, HubFeedItem, HubFeedKind, HubChipLeader, HubStoryItem, HubStoryKind } from "./hubDerive";

export interface LiveTrackerHubData {
  liveTableCount: number;
  tables: HubTableSummary[];
  feed: HubFeedItem[];
  chipLeader: HubChipLeader | null;
  /** Tournament-wide story (eliminations / milestones / final table), newest-first. */
  storyFeed: HubStoryItem[];
  /** table_id of the latest live hand — the table TournamentLiveView features by default. */
  activeHandTableId: string | null;
  loading: boolean;
}

const POLL_MS = 5_000;
const FEED_LIMIT = 8;
const HAND_PLAYERS_LIMIT = 16;
const STORY_LIMIT = 12;

export function useLiveTrackerData(tournamentId: string | undefined): LiveTrackerHubData {
  const [data, setData] = useState<LiveTrackerHubData>({
    liveTableCount: 0,
    tables: [],
    feed: [],
    chipLeader: null,
    storyFeed: [],
    activeHandTableId: null,
    loading: true,
  });
  const seqRef = useRef(0);
  const tableNamesRef = useRef<Record<string, string>>({});
  // Story-feed dedup is VIEWER-SESSION only (not a persisted event ledger): a
  // page reload re-seeds from the recent rows. Keyed sets make us robust to the
  // poll-pauses-when-hidden gap (we re-confirm by stable id, not adjacent diff).
  const seenElimRef = useRef<Set<string>>(new Set());
  const seenMilestoneRef = useRef<Set<string>>(new Set());
  const seenBubbleItmRef = useRef<Set<string>>(new Set());
  const storyRef = useRef<HubStoryItem[]>([]);

  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;
    const seq = ++seqRef.current;
    tableNamesRef.current = {};
    seenElimRef.current = new Set();
    seenMilestoneRef.current = new Set();
    seenBubbleItmRef.current = new Set();
    storyRef.current = [];

    const load = async () => {
      const [{ data: seatRows }, { data: hands }, { data: handPlayerRows }, { data: tourMeta }, { data: prizeRows }] = await Promise.all([
        supabase
          .from("tournament_seats")
          .select("player_id, seat_number, player_name, table_id, is_active, chip_count")
          .eq("tournament_id", tournamentId),
        supabase
          .from("tournament_hands")
          .select("id, table_id, is_voided")
          .eq("tournament_id", tournamentId)
          .eq("is_voided", false)
          .order("created_at", { ascending: false })
          .limit(1),
        // Recent per-hand player rows → eliminations for the story feed.
        supabase
          .from("hand_players")
          .select("player_id, hand_id, is_eliminated, created_at")
          .eq("tournament_id", tournamentId)
          .order("created_at", { ascending: false })
          .limit(HAND_PLAYERS_LIMIT),
        // Tournament meta for milestones / final table (read-only single row).
        supabase
          .from("tournaments")
          .select("players_remaining, status, itm_places")
          .eq("id", tournamentId)
          .maybeSingle(),
        // Floor-Ops prize structure: the highest paid POSITION = ITM places
        // (robust to non-contiguous positions). 1 row, position only.
        supabase
          .from("tournament_prizes")
          .select("position")
          .eq("tournament_id", tournamentId)
          .order("position", { ascending: false })
          .limit(1),
      ]);
      if (cancelled || seq !== seqRef.current) return;

      // Table display names — fetched once (names rarely change), then reused.
      if (Object.keys(tableNamesRef.current).length === 0) {
        const { data: tablesData } = await supabase.rpc("get_tournament_tables", {
          p_tournament_id: tournamentId,
        });
        if (cancelled || seq !== seqRef.current) return;
        const m: Record<string, string> = {};
        (Array.isArray(tablesData) ? tablesData : []).forEach((t: any) => {
          if (t.table_id) m[t.table_id] = t.table_name || "";
        });
        tableNamesRef.current = m;
      }

      let actions: RawAction[] = [];
      if (hands && hands.length > 0) {
        const { data: acts } = await supabase
          .from("hand_actions")
          .select("id, player_id, action_type, action_amount, action_order")
          .eq("hand_id", (hands[0] as any).id)
          .order("action_order", { ascending: false })
          .limit(FEED_LIMIT);
        if (cancelled || seq !== seqRef.current) return;
        actions = (acts as RawAction[]) || [];
      }

      const allSeatRows = (seatRows as RawSeat[]) || [];
      const seats = activeSeats(allSeatRows);
      const actionIdentityRows = FEATURES.liveViewerPulseV2 ? allSeatRows : seats;
      const nameByPlayer = new Map(actionIdentityRows.map((s) => [s.player_id, s.player_name || "Người chơi"]));
      const seatByPlayer = new Map(actionIdentityRows.map((s) => [s.player_id, s.seat_number]));
      const tables = deriveTables(seats, tableNamesRef.current);

      // Eliminated players are no longer ACTIVE seats, but their tournament_seats
      // row persists (is_active=false) → build a name map over ALL seats so the
      // story can name a busted player.
      const nameByPlayerAll = new Map(
        allSeatRows.filter((s) => !!s.player_id).map((s) => [s.player_id, s.player_name || s.player_id.slice(0, 6)])
      );
      const meta = (tourMeta as { players_remaining?: number | null; status?: string | null; itm_places?: number | null } | null);
      const playersRemaining = meta?.players_remaining ?? null;
      const status = meta?.status ?? null;

      // ITM places = highest paid prize POSITION (Floor-Ops prize structure, robust
      // to gaps), else the tournaments.itm_places column, else null → no bubble/ITM.
      const prizeMaxPosition = (prizeRows as { position?: number | null }[] | null)?.[0]?.position ?? 0;
      const itmFromColumn = meta?.itm_places ?? 0;
      const itmPlaces = prizeMaxPosition > 0 ? prizeMaxPosition : itmFromColumn > 0 ? itmFromColumn : null;

      // Tournament-wide story: new eliminations (deduped by stable id) + milestone /
      // final-table crossings + bubble/ITM (deduped via the persistent sets). Newest first.
      const freshElim = deriveEliminations((handPlayerRows as RawHandPlayer[]) || [], nameByPlayerAll, playersRemaining)
        .filter((e) => !seenElimRef.current.has(e.id));
      freshElim.forEach((e) => seenElimRef.current.add(e.id));
      const freshMilestones = deriveMilestones(playersRemaining, tables.length, status, seenMilestoneRef.current);
      const freshBubbleItm = deriveBubbleItm(playersRemaining, itmPlaces, seenBubbleItmRef.current);
      const fresh = [...freshBubbleItm, ...freshMilestones, ...freshElim];
      if (fresh.length) {
        storyRef.current = [...fresh, ...storyRef.current].slice(0, STORY_LIMIT);
      }

      setData({
        liveTableCount: tables.length,
        tables,
        feed: deriveFeed(actions, nameByPlayer, seatByPlayer),
        chipLeader: deriveChipLeader(seats),
        storyFeed: storyRef.current,
        activeHandTableId: hands && hands.length > 0 ? ((hands[0] as { table_id?: string | null }).table_id ?? null) : null,
        loading: false,
      });
    };

    // Poll only while the tab is visible — pausing when hidden saves mobile
    // battery/data, and we refresh immediately on return so data isn't stale.
    let intervalId: number | null = null;
    const startPolling = () => {
      if (intervalId == null) intervalId = window.setInterval(load, POLL_MS);
    };
    const stopPolling = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        load();
        startPolling();
      } else {
        stopPolling();
      }
    };

    load();
    if (document.visibilityState !== "hidden") startPolling();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tournamentId]);

  return data;
}
