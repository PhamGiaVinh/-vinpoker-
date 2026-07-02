// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner V2 — per-dealer notification-channel linkage
// ═══════════════════════════════════════════════════════════════════════════════
// Step 4 ("Phát hành & báo dealer") lists each dealer with their reachable channels:
// Telegram DM needs dealers.telegram_user_id; the dealer app needs dealers.user_id.
// Kept as its own tiny read so useShiftPlanner (shared with V1) stays untouched.
// Fail-soft: error → empty map (UI shows "—" instead of blocking).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DealerLinkStatus {
  telegramLinked: boolean;
  appLinked: boolean;
}

const db = supabase as unknown as { from: (table: string) => any };

export function useDealerLinkStatus({
  clubIds,
  enabled = true,
}: {
  clubIds: string[];
  /** false in mock mode → demo pattern (most linked, one not) for the preview. */
  enabled?: boolean;
}): Record<string, DealerLinkStatus> {
  const [map, setMap] = useState<Record<string, DealerLinkStatus>>({});
  const clubKey = useMemo(() => [...clubIds].sort().join(","), [clubIds]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!enabled || clubIds.length === 0) {
        if (alive) setMap({});
        return;
      }
      try {
        const { data, error } = await db
          .from("dealers")
          .select("id, telegram_user_id, user_id")
          .in("club_id", clubIds)
          .is("deleted_at", null);
        if (error) throw error;
        const m: Record<string, DealerLinkStatus> = {};
        for (const d of (data ?? []) as any[]) {
          m[d.id] = { telegramLinked: d.telegram_user_id != null, appLinked: d.user_id != null };
        }
        if (alive) setMap(m);
      } catch {
        if (alive) setMap({});
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubKey, enabled]);

  return map;
}
