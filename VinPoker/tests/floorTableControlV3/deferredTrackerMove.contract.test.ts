import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20270115000007_floor_deferred_tracker_move_v1.sql"), "utf8");
const ui = readFileSync(resolve(process.cwd(), "src/components/cashier/tournament-live/FloorTableMapPanelV3.tsx"), "utf8");

describe("deferred Floor move into active Tracker table", () => {
  it("reserves one destination seat and waits for terminal hand state", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_pending_tracker_moves_destination");
    expect(sql).toContain("WHERE status = 'pending'");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF is_active, seat_number, table_id, tournament_table_id, table_session_id");
    expect(sql).toContain("WHEN (OLD.status = 'in_progress' AND NEW.status IN ('completed', 'voided'))");
    expect(sql).toContain("v_destination_session.control_mode <> 'tracker'");
    expect(sql).toContain("v_source_session.control_mode <> 'manual'");
  });

  it("keeps the Tracker compatibility projection and caller-bound access", () => {
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("floor_table_v3_actor_is_tournament_operator");
    expect(sql).toContain("SET table_id = v_destination.game_table_id, seat_id = v_new_seat_id");
    expect(sql).toContain("v_destination.id,\n        v_destination.id, v_destination_session.id");
    expect(sql).toContain("REVOKE ALL ON TABLE public.floor_pending_tracker_moves FROM PUBLIC, anon, authenticated, service_role");
  });

  it("queues only after a direct move reports an active hand", () => {
    expect(ui).toContain('direct.error !== "table_has_active_hand"');
    expect(ui).toContain('direct.error !== "destination_table_has_active_hand"');
    expect(ui).toContain('moveDestination.controlMode !== "tracker"');
    expect(ui).toContain("return v3.queueTrackerMove(args)");
    expect(ui).toContain("v3.cancelPendingTrackerMove");
  });
});
