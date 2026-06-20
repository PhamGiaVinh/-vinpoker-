import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Read-only swing-ENGINE health for the operator console (C2). Calls the access-scoped
 * `get_dealer_swing_health` RPC and polls. Degrades gracefully: if the RPC is not applied
 * yet (or errors), `unavailable` flips true and the infra-health strip hides — so this can
 * merge before the migration is applied with zero console regression.
 */
export interface ClubSwingHealth {
  club_id: string;
  lock: {
    held: boolean;
    owner_id?: string | null;
    locked_by?: string | null;
    locked_at?: string | null;
    expires_at?: string | null;
    is_expired?: boolean;
    age_seconds?: number | null;
    heartbeat_age_seconds?: number | null;
  };
  pre_announce: { pending: number; processing: number; failed_recent: number };
  overdue_now: number;
  last_swing_activity_at: string | null;
}

export function useDealerSwingHealth(clubIds: string[], pollMs = 30_000) {
  const [data, setData] = useState<ClubSwingHealth[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const key = [...clubIds].sort().join(",");

  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); return; }
    try {
      // RPC is not in the generated Database types until applied + regenerated → cast.
      const { data: d, error } = await (supabase as { rpc: (n: string, a: unknown) => Promise<{ data: unknown; error: unknown }> })
        .rpc("get_dealer_swing_health", { p_club_ids: clubIds });
      if (error) { setUnavailable(true); return; }
      setUnavailable(false);
      setData(Array.isArray(d) ? (d as ClubSwingHealth[]) : []);
    } catch {
      setUnavailable(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    load();
    if (!clubIds.length) return;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, pollMs, key]);

  return { data, unavailable, refetch: load };
}
