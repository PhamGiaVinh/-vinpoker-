import { describe, expect, it, vi } from "vitest";
import { createFloorTableControlV3Client, type FloorTableControlV3Rpc } from "./floorTableControlV3";

const inventoryRow = {
  game_table_id: "table-5",
  table_number: 5,
  table_name: "Bàn 5",
  operational_status: "available",
  availability_status: "available",
  table_session_id: null,
  session_type: null,
  control_mode: null,
  control_epoch: null,
  revision: null,
  tournament_id: null,
  tournament_table_id: null,
  tournament_table_status: null,
  active_dealer_assignment_id: null,
};

function clientFrom(handler: ReturnType<typeof vi.fn>, enabled = true) {
  return createFloorTableControlV3Client(handler as unknown as FloorTableControlV3Rpc, { enabled });
}

describe("floorTableControlV3 browser boundary", () => {
  it("fails closed without any RPC while V3 is OFF", async () => {
    const rpc = vi.fn();
    const client = clientFrom(rpc, false);

    const result = await client.openTournamentTable({
      tournamentId: "tournament-a",
      gameTableId: "table-5",
      controlMode: "manual",
      requestId: "request-a",
    });

    expect(result).toEqual({ ok: false, error: "FLOOR_TABLE_CONTROL_V3_DISABLED" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the fixed V3 inventory RPC and rejects duplicate physical inventory", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [inventoryRow, { ...inventoryRow, game_table_id: "table-5-duplicate" }], error: null });
    const client = clientFrom(rpc);

    await expect(client.getClubTableInventory("club-a")).resolves.toEqual({
      ok: false,
      error: "V3_INVENTORY_DUPLICATE_PHYSICAL_TABLE",
    });
    expect(rpc).toHaveBeenCalledWith("get_club_table_inventory", { p_club_id: "club-a" });
  });

  it("rejects malformed inventory rather than guessing an active table session", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ ...inventoryRow, availability_status: "in_use", table_session_id: null }], error: null });
    const client = clientFrom(rpc);

    await expect(client.getClubTableInventory("club-a")).resolves.toEqual({
      ok: false,
      error: "V3_INVENTORY_ROW_INCONSISTENT",
    });
  });

  it("sends a caller-provided idempotency receipt when opening a physical table", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, table_session_id: "session-a" }, error: null });
    const client = clientFrom(rpc);

    await expect(client.openTournamentTable({
      tournamentId: "tournament-a",
      gameTableId: "table-5",
      controlMode: "tracker",
      requestId: "request-a",
    })).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("floor_open_tournament_table_v3", {
      p_tournament_id: "tournament-a",
      p_game_table_id: "table-5",
      p_control_mode: "tracker",
      p_request_id: "request-a",
    });
  });

  it("requires the Tracker fencing tuple instead of only a table id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const client = clientFrom(rpc);

    await client.validateTrackerContext({
      tournamentId: "tournament-a",
      tournamentTableId: "assignment-a",
      tableSessionId: "session-a",
      controlEpoch: 3,
    });
    expect(rpc).toHaveBeenCalledWith("validate_tracker_table_writer_context_v3", {
      p_tournament_id: "tournament-a",
      p_tournament_table_id: "assignment-a",
      p_table_session_id: "session-a",
      p_control_epoch: 3,
    });
  });
});
