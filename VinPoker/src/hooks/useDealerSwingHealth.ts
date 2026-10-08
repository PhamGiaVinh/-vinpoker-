import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Read-only swing-ENGINE health for the operator console (C2). Calls the access-scoped
 * `get_dealer_swing_health` RPC and polls only while foregrounded.
 * Errors remain explicit and cached data never crosses club scopes.
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
  const scope = [...new Set(clubIds)].sort();
  const query = useQuery({
    queryKey: ["dealer-swing-engine-health", scope],
    enabled: scope.length > 0,
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    retry: false,
    queryFn: async (): Promise<ClubSwingHealth[]> => {
      // RPC is not in the generated Database types until applied + regenerated → cast.
      const { data: d, error } = await (supabase as { rpc: (n: string, a: unknown) => Promise<{ data: unknown; error: unknown }> })
        .rpc("get_dealer_swing_health", { p_club_ids: scope });
      if (error) throw error;
      if (!Array.isArray(d) || d.some((row) => !row || !scope.includes(row.club_id) || typeof row.lock?.held !== "boolean")) {
        throw new Error("Invalid dealer swing health response");
      }
      return d as ClubSwingHealth[];
    },
  });
  return { data: scope.length ? query.data ?? null : [], unavailable: query.isError, refetch: query.refetch };
}
