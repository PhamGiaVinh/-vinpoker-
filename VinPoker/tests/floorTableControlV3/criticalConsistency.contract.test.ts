import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFloorTableControlV3Client } from "@/lib/floorTableControlV3";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20270127000000_floor_v3_critical_consistency.sql",
), "utf8");
const repairRunbook = readFileSync(resolve(
  process.cwd(),
  "docs/runbooks/FLOOR_V3_ORPHAN_SESSION_REPAIR_20260927.sql",
), "utf8");

const baseRosterRow = {
  tournament_id: "tour-1",
  tournament_table_id: "table-1",
  game_table_id: "physical-1",
  table_number: 8,
  table_name: "Bàn 8",
  table_session_id: "session-1",
  session_revision: 4,
  control_mode: "manual",
  control_epoch: 1,
  max_seats: 9,
  tournament_table_status: "active",
  session_closed_at: null,
  active_dealer_assignment_id: null,
  seat_locks: [],
};

describe("Floor V3 critical consistency contract", () => {
  it("keeps orphan sessions visible for repair and legacy seats visible but fail-closed", () => {
    expect(migration).toContain("THEN 'repair_required'");
    expect(migration).toContain("'integrity_status', CASE WHEN e.id IS NULL THEN 'missing_entry' ELSE 'valid' END");
    expect(migration).toContain("LEFT JOIN public.tournament_entries e");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\./i);
  });

  it("previews an immutable break plan and queues moves into running Tracker tables", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.floor_plan_break_table_v1");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.floor_break_table_v5");
    expect(migration).toContain("'after_current_hand'");
    expect(migration).toContain("'STALE_BREAK_PLAN'");
    expect(migration).toContain("CREATE CONSTRAINT TRIGGER trg_floor_close_completed_break_source_v1");
    expect(migration).toContain("public.tournament_entries.status = 'seated'");
    expect(migration).toContain("INSERT INTO public.tournament_chip_counts");
    expect(migration).toContain("ts.tournament_id = tt.tournament_id");
    expect(migration).toContain("ts.game_table_id = tt.game_table_id");
    expect(migration).toContain("ts.club_id = tournament_row.club_id");
    expect(migration).toContain("gt.club_id = tournament_row.club_id");
  });

  it("pins security-definer search paths and exposes only the reviewed authenticated RPCs", () => {
    for (const signature of [
      "public.get_floor_tournament_table_inventory_v1(uuid)",
      "public.get_floor_tournament_table_roster_v5(uuid)",
      "public.floor_plan_break_table_v1(uuid,bigint,text)",
      "public.floor_break_table_v5(uuid,bigint,uuid,text,text)",
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated, service_role`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated`);
    }
    expect(migration).toContain("SECURITY DEFINER SET search_path = ''");
    expect(migration).toContain("auth.uid()");
  });

  it("parses an explicit missing-entry seat without treating it as an empty seat", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      ...baseRosterRow,
      seats: [{
        seat_number: 2,
        entry_id: null,
        player_id: "player-legacy",
        display_name: "Người chơi dữ liệu cũ",
        entry_no: null,
        chip_count: 15_000,
        is_active: true,
        integrity_status: "missing_entry",
      }],
    }], error: null });
    const client = createFloorTableControlV3Client(rpc, {
      enabled: true,
      redrawSeatLockEnabled: true,
    });

    const result = await client.getTournamentTableRoster("tour-1");
    expect(result).toEqual({ ok: true, data: [expect.objectContaining({
      seats: [expect.objectContaining({ entryId: null, integrityStatus: "missing_entry" })],
    })] });
    expect(rpc).toHaveBeenCalledWith("get_floor_tournament_table_roster_v5", { p_tournament_id: "tour-1" });
  });

  it("preserves the flag-off legacy roster parser", async () => {
    const { max_seats: _maxSeats, seat_locks: _seatLocks, ...legacyRow } = baseRosterRow;
    const rpc = vi.fn().mockResolvedValue({ data: [{
      ...legacyRow,
      seats: [{
        seat_number: 1,
        entry_id: "entry-1",
        player_id: "player-1",
        display_name: "Người chơi 1",
        entry_no: 1,
        chip_count: 30_000,
        is_active: true,
      }],
    }], error: null });
    const client = createFloorTableControlV3Client(rpc, {
      enabled: true,
      redrawSeatLockEnabled: false,
    });

    const result = await client.getTournamentTableRoster("tour-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0].seats[0].integrityStatus).toBe("valid");
    expect(rpc).toHaveBeenCalledWith("get_floor_tournament_table_roster_v3", { p_tournament_id: "tour-1" });
  });

  it("keeps the exact orphan repair owner-gated and fail-closed", () => {
    expect(repairRunbook).toContain("21236017-8cf8-4997-ab0f-c5baa4ccb650");
    expect(repairRunbook).toContain("FLOOR_V3_ORPHAN_REPAIR_PREFLIGHT_CHANGED");
    expect(repairRunbook).toMatch(/NOT EXISTS \(\s+SELECT 1 FROM public\.tournament_seats/);
    expect(repairRunbook).not.toMatch(/DELETE\s+FROM/i);
  });
});
