import { describe, expect, it } from "vitest";
import {
  isDealerTableAvailable,
  isTournamentStructureBreak,
  projectDealerOperationalTable,
} from "./dealerTableInventory";
import type { FloorTableInventoryItem } from "./floorTableControlV3";

const base: FloorTableInventoryItem = {
  gameTableId: "table-5",
  tableNumber: 5,
  tableName: "Bàn 5",
  operationalStatus: "available",
  availabilityStatus: "in_use",
  tableSessionId: "session-a",
  sessionType: "tournament",
  controlMode: "tracker",
  controlEpoch: 2,
  revision: 7,
  tournamentId: "tour-a",
  tournamentTableId: "tour-table-a",
  tournamentTableStatus: "active",
  activeDealerAssignmentId: "assignment-a",
};

describe("Dealer shared table inventory projection", () => {
  it("uses the Floor V3 active session as the open-table authority", () => {
    expect(projectDealerOperationalTable("club-a", base)).toMatchObject({
      id: "table-5",
      club_id: "club-a",
      status: "active",
      table_session_id: "session-a",
      tournament_id: "tour-a",
      tournament_table_id: "tour-table-a",
      control_mode: "tracker",
      control_epoch: 2,
      revision: 7,
    });
  });

  it("does not treat a table used by another session as available", () => {
    const projected = projectDealerOperationalTable("club-a", base);
    expect(isDealerTableAvailable(projected)).toBe(false);
  });

  it("keeps maintenance above availability", () => {
    const projected = projectDealerOperationalTable("club-a", {
      ...base,
      availabilityStatus: "maintenance",
      operationalStatus: "maintenance",
      tableSessionId: null,
      sessionType: null,
      controlMode: null,
      controlEpoch: null,
      revision: null,
      tournamentId: null,
      tournamentTableId: null,
      tournamentTableStatus: null,
      activeDealerAssignmentId: null,
    });
    expect(projected.status).toBe("maintenance");
    expect(isDealerTableAvailable(projected)).toBe(false);
  });

  it("derives a tournament break from the active structure level", () => {
    expect(isTournamentStructureBreak({
      status: "active",
      current_level: 4,
      tournament_levels: [
        { level_number: 3, is_break: false },
        { level_number: 4, is_break: true },
      ],
    })).toBe(true);
    expect(isTournamentStructureBreak({
      status: "active",
      current_level: 3,
      tournament_levels: [{ level_number: 3, is_break: false }],
    })).toBe(false);
  });
});
