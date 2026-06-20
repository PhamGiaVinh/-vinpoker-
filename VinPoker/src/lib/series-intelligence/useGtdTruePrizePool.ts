// GTD #2 — read the SERVER-AUTHORITATIVE true prize pool per GTD event.
//
// Calls the read-only RPC `get_tournament_prize_pool` (SUM of confirmed buy_in) for each event
// that has a committed GTD, and returns a map keyed by event id. The server is the source of
// truth — the client only reads these values; it never recomputes the true number.
//
// Gated by FEATURES.gtdTruePrizePool. While OFF — or until the RPC is applied live — this
// returns null and the UI stays on the #415 "ước tính" estimate.
//
// The RPC is applied live and present in generated types, so the call is fully typed.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import type { SeriesEvent } from "./nativeData";
import type { TruePrizePool } from "./gtdOverlay";

export function useGtdTruePrizePool(events: SeriesEvent[]): Map<string, TruePrizePool> | null {
  const [map, setMap] = useState<Map<string, TruePrizePool> | null>(null);

  // Only the GTD-bearing event ids drive the fetch (stable key for the effect).
  const gtdIds = events.filter((e) => e.gtd !== null).map((e) => e.event_id);
  const key = gtdIds.join(",");

  useEffect(() => {
    if (!FEATURES.gtdTruePrizePool) {
      setMap(null);
      return;
    }
    if (gtdIds.length === 0) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const entries: Array<[string, TruePrizePool]> = [];
      for (const id of gtdIds) {
        const { data, error } = await supabase.rpc("get_tournament_prize_pool", {
          p_tournament_id: id,
        });
        if (error) continue;
        const row = data?.[0];
        if (row) {
          entries.push([
            id,
            {
              prizePool: Number(row.prize_pool) || 0,
              confirmedEntryCount: Number(row.confirmed_entry_count) || 0,
            },
          ]);
        }
      }
      if (!cancelled) setMap(new Map(entries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}
