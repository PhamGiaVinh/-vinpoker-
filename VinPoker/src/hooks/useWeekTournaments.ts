// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner V2 — tournaments-per-day for the week strip demand assist
// ═══════════════════════════════════════════════════════════════════════════════
// Owner request: when planning the week, show per day "có N tour → cần ~M dealer"
// so the floor can estimate demand from the tournament schedule. This is a
// READ-ONLY count over the existing `tournaments` table (club-scoped, by
// start_time within each club-local day). Fail-soft: any error → empty map.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const TZ_OFFSET_MS = 420 * 60_000; // VN club-local (mirrors useShiftPlanner)
const DAY_MS = 86_400_000;

const db = supabase as unknown as { from: (table: string) => any };

/** Map YYYY-MM-DD → number of (non-cancelled, non-deleted) tournaments starting that club-local day. */
export function useWeekTournaments({
  clubId,
  dates,
  enabled = true,
}: {
  clubId: string | null | undefined;
  dates: string[]; // YYYY-MM-DD, club-local
  enabled?: boolean;
}): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const dateKey = useMemo(() => [...dates].sort().join(","), [dates]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!enabled || !clubId || dates.length === 0) {
        if (alive) setCounts({});
        return;
      }
      try {
        const sorted = [...dates].sort();
        const lowMs = Date.parse(`${sorted[0]}T00:00:00Z`) - TZ_OFFSET_MS;
        const highMs = Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`) - TZ_OFFSET_MS + DAY_MS;
        const { data, error } = await db
          .from("tournaments")
          .select("id, start_time, status")
          .eq("club_id", clubId)
          .is("deleted_at", null)
          .gte("start_time", new Date(lowMs).toISOString())
          .lt("start_time", new Date(highMs).toISOString());
        if (error) throw error;
        const map: Record<string, number> = {};
        for (const t of (data ?? []) as any[]) {
          if (!t.start_time || t.status === "cancelled") continue;
          const localDay = new Date(Date.parse(t.start_time) + TZ_OFFSET_MS).toISOString().slice(0, 10);
          map[localDay] = (map[localDay] ?? 0) + 1;
        }
        if (alive) setCounts(map);
      } catch {
        if (alive) setCounts({});
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, dateKey, enabled]);

  return counts;
}
