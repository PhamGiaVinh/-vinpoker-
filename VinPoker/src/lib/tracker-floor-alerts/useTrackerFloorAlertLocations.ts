import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type AlertLocation = { physical_table_id: string; hand_id: string | null };
export type FloorAlertLocation = { tableNumber?: number; handNumber?: number };

export function useTrackerFloorAlertLocations(client: SupabaseClient, alerts: readonly AlertLocation[]) {
  const [locations, setLocations] = useState<Record<string, FloorAlertLocation>>({});
  const tableIds = [...new Set(alerts.map((alert) => alert.physical_table_id))].sort().join(",");
  const handIds = [...new Set(alerts.map((alert) => alert.hand_id).filter((id): id is string => !!id))].sort().join(",");

  useEffect(() => {
    let active = true;
    if (!tableIds) {
      setLocations({});
      return;
    }
    const load = async () => {
      const [tables, hands] = await Promise.all([
        client.from("game_tables").select("id,table_number").in("id", tableIds.split(",")),
        handIds
          ? client.from("tournament_hands").select("id,hand_number").in("id", handIds.split(","))
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;
      const tableNumbers = new Map((tables.data ?? []).map((row) => [row.id, row.table_number]));
      const handNumbers = new Map((hands.data ?? []).map((row) => [row.id, row.hand_number]));
      const next: Record<string, FloorAlertLocation> = {};
      for (const alert of alerts) {
        next[alert.physical_table_id + ":" + (alert.hand_id ?? "")] = {
          tableNumber: tableNumbers.get(alert.physical_table_id) ?? undefined,
          handNumber: alert.hand_id ? handNumbers.get(alert.hand_id) ?? undefined : undefined,
        };
      }
      setLocations(next);
    };
    void load();
    return () => { active = false; };
  }, [client, tableIds, handIds, alerts]);

  return (alert: AlertLocation) => locations[alert.physical_table_id + ":" + (alert.hand_id ?? "")];
}
