// Series Intelligence — read-only native data probe (Phase 1).
// Reads the club owner's own tournaments under EXISTING RLS (no new RPC), maps
// them through the pure adapter, and returns an inventory summary. READ-ONLY:
// only `.select` is used — no insert/update/delete/upsert/rpc, no writes.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  mapTournamentToEvent,
  summarizeInventory,
  type InventorySummary,
  type NativeTournamentRow,
  type SeriesEvent,
} from "./nativeData";

export type NativeProbeStatus = "loading" | "ready" | "unavailable";

export interface NativeSeriesData {
  status: NativeProbeStatus;
  events: SeriesEvent[];
  summary: InventorySummary | null;
  reason: string | null;
}

export function useNativeSeriesEvents(): NativeSeriesData {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<NativeSeriesData>({
    status: "loading",
    events: [],
    summary: null,
    reason: null,
  });

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    if (!user) {
      setState({ status: "unavailable", events: [], summary: null, reason: "Chưa đăng nhập." });
      return;
    }

    (async () => {
      try {
        // Owned clubs (existing pattern; RLS-scoped).
        const { data: clubs, error: clubErr } = await supabase
          .from("clubs")
          .select("id")
          .eq("owner_id", user.id);
        if (clubErr) throw clubErr;

        const clubIds = (clubs ?? []).map((c) => c.id);
        if (clubIds.length === 0) {
          if (!cancelled)
            setState({ status: "unavailable", events: [], summary: null, reason: "Tài khoản chưa sở hữu CLB nào." });
          return;
        }

        // Read-only tournament probe, owner-scoped + RLS-scoped.
        const { data: tours, error: tourErr } = await supabase
          .from("tournaments")
          .select("id,name,start_time,buy_in,rake_amount,service_fee_amount,prize_pool,club_id")
          .in("club_id", clubIds)
          .is("deleted_at", null);
        if (tourErr) throw tourErr;

        const events = (tours ?? []).map((t) => mapTournamentToEvent(t as unknown as NativeTournamentRow));
        if (!cancelled) setState({ status: "ready", events, summary: summarizeInventory(events), reason: null });
      } catch (e) {
        const reason = e instanceof Error ? e.message : "Không đọc được dữ liệu.";
        if (!cancelled) setState({ status: "unavailable", events: [], summary: null, reason });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return state;
}
