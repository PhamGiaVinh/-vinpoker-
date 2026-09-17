import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type AlertLocation = { physical_table_id: string; hand_id: string | null };
export type FloorAlertLocation = { tableNumber?: number; handNumber?: number; handStatus?: string; handVoided?: boolean };

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
          ? client.from("tournament_hands").select("id,hand_number,status,is_voided").in("id", handIds.split(","))
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (!active) return;
      const tableNumbers = new Map((tables.data ?? []).map((row) => [row.id, row.table_number]));
      const handRows = new Map((hands.data ?? []).map((row) => [row.id, row]));
      const next: Record<string, FloorAlertLocation> = {};
      for (const alert of alerts) {
        next[alert.physical_table_id + ":" + (alert.hand_id ?? "")] = {
          tableNumber: tableNumbers.get(alert.physical_table_id) ?? undefined,
          handNumber: alert.hand_id ? handRows.get(alert.hand_id)?.hand_number ?? undefined : undefined,
          handStatus: alert.hand_id ? handRows.get(alert.hand_id)?.status ?? undefined : undefined,
          handVoided: alert.hand_id ? handRows.get(alert.hand_id)?.is_voided === true : undefined,
        };
      }
      setLocations(next);
    };
    void load();
    return () => { active = false; };
  }, [client, tableIds, handIds, alerts]);

  return (alert: AlertLocation) => locations[alert.physical_table_id + ":" + (alert.hand_id ?? "")];
}
