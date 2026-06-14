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
import {
  activeSeats,
  deriveFeed,
  deriveTables,
  type HubFeedItem,
  type HubTableSummary,
  type RawAction,
  type RawSeat,
} from "./hubDerive";

export type { HubTableSummary, HubFeedItem, HubFeedKind } from "./hubDerive";

export interface LiveTrackerHubData {
  liveTableCount: number;
  tables: HubTableSummary[];
  feed: HubFeedItem[];
  loading: boolean;
}

const POLL_MS = 5_000;
const FEED_LIMIT = 8;

export function useLiveTrackerData(tournamentId: string | undefined): LiveTrackerHubData {
  const [data, setData] = useState<LiveTrackerHubData>({
    liveTableCount: 0,
    tables: [],
    feed: [],
    loading: true,
  });
  const seqRef = useRef(0);
  const tableNamesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;
    const seq = ++seqRef.current;
    tableNamesRef.current = {};

    const load = async () => {
      const [{ data: seatRows }, { data: hands }] = await Promise.all([
        supabase
          .from("tournament_seats")
          .select("player_id, seat_number, player_name, table_id, is_active")
          .eq("tournament_id", tournamentId),
        supabase
          .from("tournament_hands")
          .select("id, table_id, is_voided")
          .eq("tournament_id", tournamentId)
          .eq("is_voided", false)
          .order("created_at", { ascending: false })
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

      const seats = activeSeats((seatRows as RawSeat[]) || []);
      const nameByPlayer = new Map(seats.map((s) => [s.player_id, s.player_name || s.player_id.slice(0, 6)]));
      const seatByPlayer = new Map(seats.map((s) => [s.player_id, s.seat_number]));
      const tables = deriveTables(seats, tableNamesRef.current);

      setData({
        liveTableCount: tables.length,
        tables,
        feed: deriveFeed(actions, nameByPlayer, seatByPlayer),
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
