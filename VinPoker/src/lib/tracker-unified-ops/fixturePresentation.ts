import type { TrackerTableSummaryV2 } from "./contracts";
import { TRACKER_TABLE_LIST_FIXTURE } from "./fixtures";

export function getTrackerFixtureTables(
  tournamentId: string,
): TrackerTableSummaryV2[] {
  return TRACKER_TABLE_LIST_FIXTURE.tables.map((table) => ({
    ...table,
    tournament_id: tournamentId,
  }));
}
