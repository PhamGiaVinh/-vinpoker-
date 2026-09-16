import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

export function useInputTableAlerts(tournamentId: string) {
  const client = useSupabaseClient() as SupabaseClient;
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!tournamentId) return;
      const { data, error } = await client
        .from("tracker_floor_alerts")
        .select("physical_table_id")
        .eq("tournament_id", tournamentId)
        .in("status", ["open", "acknowledged", "in_progress"]);
      if (!active || error) return;
      const next: Record<string, number> = {};
      for (const row of (data ?? []) as { physical_table_id: string }[]) {
        next[row.physical_table_id] = (next[row.physical_table_id] ?? 0) + 1;
      }
      setCounts(next);
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [client, tournamentId]);

  return counts;
}
