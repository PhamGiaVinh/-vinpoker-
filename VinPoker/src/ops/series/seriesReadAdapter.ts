import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type SeriesEventRead = {
  id: string;
  name: string;
  date: string;
  buyIn: number;
  gtd: number;
  prizePool: number;
  totalEntries: number;
  uniqueEntries: number;
  reentries: number;
};

export type SeriesReadModel = {
  events: SeriesEventRead[];
  totalEntries: number;
  totalPrizePool: number;
  missingGtdCount: number;
};

type OpsClient = SupabaseClient<Database>;

export async function loadSeriesReadModel(client: OpsClient, clubId: string): Promise<SeriesReadModel> {
  const result = await client.rpc("get_club_series_events", { p_club_id: clubId });
  if (result.error) throw new Error("SERIES_READ_RPC_UNAVAILABLE");
  const rows = result.data ?? [];
  if (rows.some((row) => row.club_id !== clubId)) throw new Error("SERIES_READ_SCOPE_MISMATCH");
  const events = rows.map((row) => ({
    id: row.event_id,
    name: row.event_name,
    date: row.event_date,
    buyIn: safeNumber(row.buy_in),
    gtd: safeNumber(row.gtd),
    prizePool: safeNumber(row.prize_pool_actual),
    totalEntries: safeNumber(row.total_entries),
    uniqueEntries: safeNumber(row.unique_entries),
    reentries: safeNumber(row.reentries),
  }));
  return {
    events,
    totalEntries: events.reduce((sum, event) => sum + event.totalEntries, 0),
    totalPrizePool: events.reduce((sum, event) => sum + event.prizePool, 0),
    missingGtdCount: events.filter((event) => event.gtd <= 0).length,
  };
}

function safeNumber(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("SERIES_READ_MALFORMED");
  return value;
}
