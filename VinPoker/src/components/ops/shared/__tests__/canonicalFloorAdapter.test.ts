import { describe, expect, it } from "vitest";
import { buildCanonicalOperationalFloor } from "../floorAdapter";
import type { FloorTournamentInventoryItem } from "@/lib/floorTableControlV3";
import type { TournamentParticipation } from "@/lib/tournamentParticipation";

const inventory: FloorTournamentInventoryItem[] = [{
  gameTableId: "physical", tournamentTableId: "logical", tableSessionId: "session-B",
  tableNumber: 2, tableName: "Bàn 2", operationalStatus: "available",
  availabilityStatus: "current_tournament", controlMode: "tracker",
  controlEpoch: 7, revision: 12, maxSeats: 9,
}];
const participation = (overrides = {}): TournamentParticipation => ({
  tournament_id: "tour", entries: [],
  counts: { total_entries: 1, re_entries: 0, remaining: 1, seated: 1, waiting: 0,
    busted: 0, anomaly_entries: 0, anomaly_seats: 0, live_entry_stack: 100,
    seated_stack: 100, waiting_stack: 0 },
  seats: [{ seat_id: "real-seat", entry_id: "entry", player_id: "player",
    player_name: "Player", entry_number: 1, table_id: "logical",
    tournament_table_id: "logical", table_session_id: "session-B", table_name: "Bàn 2",
    seat_number: 3, chip_count: 100, is_active: true,
    participation_status: "seated", anomaly_reason: null, ...overrides }],
});

describe("canonical Ops Floor projection", () => {
  it("reads mode/epoch from the current incarnation and preserves the actual seat ID", () => {
    const result = buildCanonicalOperationalFloor(inventory, participation());
    expect(result.tables[0]).toMatchObject({ floor_control_mode: "tracker",
      floor_control_revision: 12, table_session_id: "session-B", control_epoch: 7 });
    expect(result.seatsByTable.physical[0]).toMatchObject({ seat_id: "real-seat", chip_count: 100 });
  });
  it("rejects a seat from the previous incarnation of the same physical table", () => {
    const result = buildCanonicalOperationalFloor(inventory, participation({ table_session_id: "session-A" }));
    expect(result.tables).toHaveLength(1);
    expect(result.seatsByTable.physical).toBeUndefined();
    expect(result.repairWarnings[0]).toContain("Player");
  });
  it("does not hide an invalid occupied seat or infer its entry", () => {
    const result = buildCanonicalOperationalFloor(inventory, participation({ entry_id: null,
      participation_status: "anomaly", anomaly_reason: "missing_entry" }));
    expect(result.seatsByTable.physical[0]).toMatchObject({ seat_id: "real-seat", entry_id: null,
      chip_count: 100, integrity_status: "missing_entry" });
    expect(result.repairWarnings[0]).toContain("missing_entry");
  });
  it("rejects duplicate occupied positions rather than choosing a player", () => {
    const projection = participation();
    projection.seats.push({ ...projection.seats[0], seat_id: "second-seat" });
    expect(() => buildCanonicalOperationalFloor(inventory, projection)).toThrow("Cần sửa dữ liệu");
  });
});
