// Series Intelligence — native data probe (Phase 2).
// Reads the club owner's own series events via the owner-scoped, STABLE
// `get_club_series_events` RPC (the server enforces ownership — no client-side
// club aggregation), maps each row through the pure adapter, and returns an
// inventory summary. READ-ONLY: only `.rpc` is used for a STABLE read — no
// insert/update/delete/upsert, no writes.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  mapRpcRowToEvent,
  summarizeInventory,
  type ClubSeriesEventRow,
  type InventorySummary,
  type SeriesEvent,
} from "./nativeData";

export type NativeProbeStatus = "loading" | "ready" | "unavailable";

export interface NativeSeriesData {
  status: NativeProbeStatus;
  events: SeriesEvent[];
  summary: InventorySummary | null;
  reason: string | null;
}

/** Optional server-side filters. The RPC args are optional strings — never pass null. */
export interface NativeSeriesQuery {
  clubId?: string;
  from?: string;
  to?: string;
}

export function useNativeSeriesEvents(query?: NativeSeriesQuery): NativeSeriesData {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<NativeSeriesData>({
    status: "loading",
    events: [],
    summary: null,
    reason: null,
  });

  const clubId = query?.clubId;
  const from = query?.from;
  const to = query?.to;

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    if (!user) {
      setState({ status: "unavailable", events: [], summary: null, reason: "Chưa đăng nhập." });
      return;
    }

    (async () => {
      try {
        // Build args conditionally — the generated RPC args are optional strings
        // (p_club_id?/p_from?/p_to?); do NOT pass explicit null.
        const args: { p_club_id?: string; p_from?: string; p_to?: string } = {};
        if (clubId) args.p_club_id = clubId;
        if (from) args.p_from = from;
        if (to) args.p_to = to;

        // Owner-scoped, STABLE read RPC. Ownership is enforced server-side; we never
        // merge across clubs on the client — each row keeps its own club_id.
        const { data, error } = await supabase.rpc("get_club_series_events", args);
        if (error) throw error;

        const rows = (data ?? []) as ClubSeriesEventRow[];
        const events = rows.map(mapRpcRowToEvent);
        if (!cancelled)
          setState({ status: "ready", events, summary: summarizeInventory(events), reason: null });
      } catch (e) {
        // Only an actual RPC failure lands here → "unavailable" fallback in the UI.
        const reason = e instanceof Error ? e.message : "Không đọc được dữ liệu.";
        if (!cancelled) setState({ status: "unavailable", events: [], summary: null, reason });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, clubId, from, to]);

  return state;
}
