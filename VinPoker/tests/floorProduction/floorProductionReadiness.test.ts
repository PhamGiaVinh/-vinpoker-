import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canAccessMobileCashier, canAccessMobileOps } from "../../src/lib/opsCapabilities";
import { floorOpsErrorMessage } from "../../src/lib/floorOpsErrors";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20261240000000_floor_production_hardening.sql");
const clockStartMigration = read("supabase/migrations/20261241000000_floor_clock_start_atomic.sql");
const drawEdge = read("supabase/functions/tournament-live-draw/index.ts");
const clockEdge = read("supabase/functions/tournament-live-clock/index.ts");
const app = read("src/App.tsx");
const cockpit = read("src/pages/ops/OpsTournamentCockpit.tsx");
const flags = read("src/lib/featureFlags.ts");
const playerActions = read("src/components/ops/shared/PlayerActionSheets.tsx");
const bustDialog = read("src/components/cashier/tournament-live/BustConfirmDialog.tsx");
const cashierAccess = read("src/components/ops/OpsCashierAccess.tsx");

function functionBody(name: string, nextName?: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = nextName
    ? migration.indexOf(`CREATE OR REPLACE FUNCTION public.${nextName}`, start + 1)
    : migration.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("Floor production readiness contracts", () => {
  it("gates mobile operations to explicit operator capabilities", () => {
    const none = {
      isAdmin: false,
      isClubAdmin: false,
      isClubOwner: false,
      isCashier: false,
      isTracker: false,
      isFloor: false,
    };
    expect(canAccessMobileOps(none)).toBe(false);
    expect(canAccessMobileOps({ ...none, isFloor: true })).toBe(true);
    expect(canAccessMobileOps({ ...none, isCashier: true })).toBe(true);
    expect(canAccessMobileOps({ ...none, isTracker: true })).toBe(true);
    expect(canAccessMobileCashier({ ...none, isFloor: true })).toBe(false);
    expect(canAccessMobileCashier({ ...none, isClubOwner: true })).toBe(true);
    expect(canAccessMobileCashier({ ...none, isCashier: true })).toBe(true);
  });

  it("keeps the money-path dependency flag off while core verified Floor flags stay on", () => {
    expect(flags).toMatch(/floorTableOps:\s*true/);
    expect(flags).toMatch(/mobileOpsV2:\s*true/);
    expect(flags).toMatch(/cockpitFloorActions:\s*true/);
    expect(flags).toMatch(/closeReport:\s*true/);
    expect(flags).toMatch(/tournamentClockV2:\s*true/);
    expect(flags).toMatch(/floorAtomicPayout:\s*false/);
  });

  it("ships every hardened RPC as a forward-only replacement with locked-down grants", () => {
    for (const name of [
      "floor_assign_player_to_seat",
      "move_player_seat",
      "floor_bust_player",
      "restore_busted_player_to_seat",
      "close_tournament",
      "close_tournament_table",
      "redraw_tournament",
      "open_tournament_table",
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${name}`);
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${name}`);
    }
    expect(migration).toContain("public.is_club_floor(v_actor, v_tour.club_id)");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.(tournament_seats|tournament_entries|tournament_close_report)/i);
  });

  it("busts the seat and canonical entry atomically without applying a payout", () => {
    const body = functionBody("floor_bust_player", "restore_busted_player_to_seat");
    expect(body).toContain("FOR UPDATE");
    expect(body).toContain("'player_has_chips'");
    expect(body).toContain("'player_in_active_hand'");
    expect(body).toContain("SET status = 'busted', is_active = false");
    expect(body).toContain("UPDATE public.tournament_entries");
    expect(body).toContain("'payout_applied', false");
    expect(drawEdge).toContain('supabase.rpc("floor_bust_player"');
    expect(drawEdge).not.toContain(".update({ is_active: false })");
  });

  it("fails close-table before planning when an active seat is orphaned or mismatched", () => {
    const body = functionBody("close_tournament_table", "redraw_tournament");
    const orphan = body.indexOf("'orphan_active_seat'");
    const mismatch = body.indexOf("'seat_entry_mismatch'");
    const plan = body.indexOf("CREATE TEMP TABLE _floor_close_movers");
    expect(orphan).toBeGreaterThan(0);
    expect(mismatch).toBeGreaterThan(orphan);
    expect(plan).toBeGreaterThan(mismatch);
    expect(body).toContain("RAISE EXCEPTION 'source_table_not_empty'");
    expect(body).not.toContain("Deactivate any remaining");
  });

  it("validates the full active-seat graph before redraw and never uses player-id move fallback", () => {
    const move = functionBody("move_player_seat", "restore_busted_player_to_seat");
    const redraw = functionBody("redraw_tournament", "open_tournament_table");
    expect(move).toContain("Exact entry linkage only");
    expect(move).toContain("entry_id = p_entry_id");
    expect(move).not.toContain("Fallback: find by player_id");
    expect(redraw.indexOf("'orphan_active_seat'")).toBeLessThan(redraw.indexOf("CREATE TEMP TABLE _floor_redraw_elig"));
    expect(redraw.indexOf("'seat_entry_mismatch'")).toBeLessThan(redraw.indexOf("CREATE TEMP TABLE _floor_redraw_elig"));
    expect(redraw).toContain("'seat_table_mismatch'");
  });

  it("keeps close idempotent but blocks active players before money aggregation", () => {
    const body = functionBody("close_tournament", "close_tournament_table");
    expect(body.indexOf("'outcome', 'already_closed'")).toBeLessThan(body.indexOf("'active_players_remaining'"));
    expect(body.indexOf("'active_players_remaining'")).toBeLessThan(body.indexOf("FROM public.tournament_registrations"));
    expect(floorOpsErrorMessage("active_players_remaining")).toContain("Vẫn còn người");
  });

  it("blocks restore after close/payment and requires an explicit UI confirmation", () => {
    const body = functionBody("restore_busted_player_to_seat", "close_tournament");
    expect(body).toContain("FROM public.tournament_close_report");
    expect(body).toContain("FROM public.tournament_prize_payments");
    expect(body).toContain("'prize_already_paid'");
    expect(body).toContain("'busted_seat_not_found'");
    expect(body).toContain("AND status = 'busted'");
    expect(cockpit).toContain("Chỉ dùng khi vừa loại nhầm và trước khi chốt giải/trả thưởng");
    expect(cockpit).toContain('type="checkbox"');
    expect(cockpit).toContain("!restoreConfirmed");
  });

  it("hardens Edge writes without service-role or client-controlled identity", () => {
    for (const edge of [drawEdge, clockEdge]) {
      expect(edge).toContain("supabase.auth.getUser()");
      expect(edge).toContain('supabase.rpc("floor_club_ids"');
      expect(edge).toContain('supabase.rpc("cashier_club_ids"');
      expect(edge).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(edge).not.toMatch(/\bany\b/);
    }
    expect(drawEdge).toContain("expected_chip_count");
    expect(drawEdge).toContain('supabase.rpc("floor_bust_player"');
    expect(drawEdge).toContain("stale_seat_state");
    expect(drawEdge).toContain("seat_entry_mismatch");
    expect(drawEdge).toContain("body.seats.length !== 1");
    expect(drawEdge).toContain('error: "update_seats accepts exactly one seat"');
    expect(drawEdge).toContain("Use the audited Floor RPC for this action");
    expect(drawEdge).not.toContain(".insert(");
    expect(drawEdge).not.toMatch(/\.update\(\{[^}]*player_id/s);
    expect(drawEdge).not.toMatch(/\.update\(\{[^}]*table_id/s);
    expect(clockEdge).toContain("stale_clock_state");
    expect(clockEdge).toContain('.select("id").maybeSingle()');
    expect(clockEdge).toContain('supabase.rpc("floor_start_tournament_clock"');
    expect(clockEdge).not.toContain('supabase.rpc("update_tournament_state"');
    expect(drawEdge).toContain('error: "draw_operation_failed"');
    expect(clockEdge).toContain('error: "clock_operation_failed"');
    expect(drawEdge).not.toContain("error: message(error)");
    expect(clockEdge).not.toContain("error: detail");
  });

  it("starts the clock in one locked, audited server transaction", () => {
    expect(clockStartMigration).toContain("CREATE OR REPLACE FUNCTION public.floor_start_tournament_clock");
    expect(clockStartMigration).toContain("FOR UPDATE");
    expect(clockStartMigration).toContain("clock_started_at IS NOT NULL");
    expect(clockStartMigration).toContain("AND clock_started_at IS NULL");
    expect(clockStartMigration).toContain("tournament_state_transitions");
    expect(clockStartMigration).toContain("changed_by");
    expect(clockStartMigration).toContain("floor_tournament_clock_started");
    expect(clockStartMigration).toContain("SET search_path = public");
    expect(clockStartMigration).toContain("REVOKE ALL ON FUNCTION public.floor_start_tournament_clock(UUID) FROM PUBLIC, anon;");
  });

  it("removes reachable mobile fixture modules and routes unfinished modules honestly", () => {
    expect(app).not.toContain('import("./pages/ops/OpsFnb")');
    expect(app).not.toContain('import("./pages/ops/OpsChipOps")');
    expect(app).not.toContain('import("./pages/ops/OpsFinance")');
    expect(app).toContain("OpsDesktopOnly");
    expect(app).toContain("<OpsCashierAccess><OpsCashier /></OpsCashierAccess>");
    expect(cashierAccess).toContain("canAccessMobileCashier");
    for (const page of ["OpsAlerts.tsx", "OpsMore.tsx", "OpsTournaments.tsx"]) {
      const source = read(`src/pages/ops/${page}`);
      expect(source).not.toContain("MOCK_");
      expect(source).not.toContain("MockChip");
      expect(source).not.toContain("bản mẫu");
    }
    expect(playerActions).not.toContain("bản mẫu");
    expect(playerActions).not.toContain("MOVE_TABLES");
    expect(playerActions).not.toContain("HANOI ROYAL");
    expect(bustDialog).toContain("Thưởng tạm tính — chưa chốt");
    expect(bustDialog).toContain("Chỉ loại người chơi");
  });
});
