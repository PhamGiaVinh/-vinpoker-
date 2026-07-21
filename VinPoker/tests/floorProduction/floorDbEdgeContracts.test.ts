import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20261240000000_floor_production_hardening.sql");
const clockMigration = read("supabase/migrations/20261241000000_floor_clock_start_atomic.sql");
const operatorScopeMigration = read("supabase/migrations/20261242000000_floor_operator_scope.sql");
const cleanupIndexMigration = read("supabase/migrations/20270104000000_floor_cleanup_rotation_schedule_index.sql");
const chipCasMigration = read("supabase/migrations/20270104000001_floor_chip_cas_rpc.sql");
const clockControlMigration = read("supabase/migrations/20270104000004_floor_clock_control_atomic.sql");
const drawEdge = read("supabase/functions/tournament-live-draw/index.ts");
const clockEdge = read("supabase/functions/tournament-live-clock/index.ts");
const operatorClubsHook = read("src/hooks/useOperatorClubs.ts");
const opsShell = read("src/components/ops/OpsShell.tsx");
const cashierAccess = read("src/components/ops/OpsCashierAccess.tsx");
const desktopFloor = read("src/pages/FloorDashboard.tsx");
const floorTableMap = read("src/components/cashier/tournament-live/FloorTableMapPanel.tsx");
const playersGrouped = read("src/components/cashier/tournament-live/PlayersGroupedPanel.tsx");
const editChipsDialog = read("src/components/cashier/tournament-live/EditChipsDialog.tsx");
const clockPanel = read("src/components/cashier/tournament-live/ClockPanel.tsx");
const opsCockpit = read("src/pages/ops/OpsTournamentCockpit.tsx");

function body(name: string, next?: string) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = next ? migration.indexOf(`CREATE OR REPLACE FUNCTION public.${next}`, start + 1) : migration.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("Floor V2 DB and Edge contracts", () => {
  it("replaces each audited RPC with a definer function locked to public search_path", () => {
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
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
      const grant = migration.indexOf(`GRANT EXECUTE ON FUNCTION public.${name}`, start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(grant).toBeGreaterThan(start);
      expect(migration.slice(start, grant)).toContain("SECURITY DEFINER");
      expect(migration.slice(start, grant)).toContain("SET search_path = public");
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${name}`);
    }
    expect(migration).not.toMatch(/TO authenticated, service_role;/);
    expect(clockMigration).not.toMatch(/TO authenticated, service_role;/);
  });

  it("derives the authenticated actor server-side and keeps legacy actor input optional", () => {
    const move = body("move_player_seat", "floor_bust_player");
    const restore = body("restore_busted_player_to_seat", "close_tournament");
    expect(move).toContain("v_actor UUID := auth.uid()");
    expect(move).toContain("p_actor_user_id UUID DEFAULT NULL");
    expect(move).toContain("IF p_actor_user_id IS NOT NULL AND p_actor_user_id IS DISTINCT FROM v_actor");
    expect(restore).toContain("v_actor UUID := auth.uid()");
    expect(restore).toContain("p_actor_user_id UUID DEFAULT NULL");
  });

  it("keeps moves and redraws fail-closed on stale or inconsistent seat graphs", () => {
    const move = body("move_player_seat", "floor_bust_player");
    const close = body("close_tournament_table", "redraw_tournament");
    const redraw = body("redraw_tournament", "open_tournament_table");
    expect(move).toContain("entry_id = p_entry_id");
    expect(move).toContain("'seat_entry_mismatch'");
    expect(move).toContain("'seat_occupied'");
    for (const fragment of ["'orphan_active_seat'", "'seat_entry_mismatch'", "'insufficient_capacity'"]) {
      expect(close).toContain(fragment);
    }
    expect(close).toContain("RAISE EXCEPTION 'source_table_not_empty'");
    expect(redraw).toContain("p_dry_run");
    expect(redraw).toContain("'orphan_active_seat'");
    expect(redraw).toContain("'seat_table_mismatch'");
    expect(redraw).toContain("CREATE TEMP TABLE _floor_redraw_plan");
  });

  it("makes bust and restore atomic without a payout side effect", () => {
    const bust = body("floor_bust_player", "restore_busted_player_to_seat");
    const restore = body("restore_busted_player_to_seat", "close_tournament");
    expect(bust).toContain("FOR UPDATE");
    expect(bust).toContain("'player_has_chips'");
    expect(bust).toContain("'player_in_active_hand'");
    expect(bust).toContain("'error', 'already_busted'");
    expect(bust).toContain("SET status = 'busted', is_active = false");
    expect(bust).toContain("'payout_applied', false");
    expect(restore).toContain("FROM public.tournament_close_report");
    expect(restore).toContain("FROM public.tournament_prize_payments");
    expect(restore).toContain("'prize_already_paid'");
    expect(restore).toContain("AND status = 'busted'");
  });

  it("starts the tournament clock under one tournament lock and audited transition", () => {
    expect(clockMigration).toContain("CREATE OR REPLACE FUNCTION public.floor_start_tournament_clock");
    expect(clockMigration).toContain("v_actor UUID := auth.uid()");
    expect(clockMigration).toContain("FOR UPDATE");
    expect(clockMigration).toContain("clock_started_at IS NOT NULL");
    expect(clockMigration).toContain("AND clock_started_at IS NULL");
    expect(clockMigration).toContain("tournament_state_transitions");
    expect(clockMigration).toContain("floor_tournament_clock_started");
  });

  it("routes every post-start clock write through one caller-bound locked RPC", () => {
    expect(clockControlMigration).toContain("CREATE OR REPLACE FUNCTION public.floor_control_tournament_clock");
    expect(clockControlMigration).toContain("v_actor UUID := auth.uid()");
    expect(clockControlMigration).toContain("SECURITY DEFINER");
    expect(clockControlMigration).toContain("SET search_path = public");
    expect(clockControlMigration).toContain("FOR UPDATE");
    expect(clockControlMigration).toContain(
      "v_tour.status::TEXT IN ('completed', 'cancelled', 'finished')",
    );
    expect(clockControlMigration).toContain("p_expected_control_revision TEXT");
    expect(clockControlMigration).toContain("v_current_control_revision := md5(jsonb_build_array(");
    expect(clockControlMigration).toContain("p_expected_control_revision !~ '^[0-9a-f]{32}$'");
    expect(clockControlMigration).toContain("IS DISTINCT FROM p_expected_control_revision");
    expect(clockControlMigration).toContain("'expected_control_revision_required'");
    expect(clockControlMigration).toContain("'clock_paused_at', v_tournament.clock_paused_at");
    expect(clockControlMigration).toContain("'stale_clock_state'");
    expect(clockControlMigration).toContain("clock_started_at = v_now");
    expect(clockControlMigration).toContain("pause_accumulated = 0");
    expect(clockControlMigration).toContain("v_target_elapsed_seconds");
    expect(clockControlMigration).toContain("v_new_started_at := v_reference_time");
    expect(clockControlMigration).toContain("FROM public.club_cashiers cc");
    expect(clockControlMigration).toContain("FROM public.club_floors cf");
    expect(clockControlMigration).not.toContain("public.user_roles");
    for (const action of ["pause", "resume", "next_level", "previous_level", "adjust_time"]) {
      expect(clockControlMigration).toContain(`'${action}'`);
    }
    expect(clockControlMigration).toContain("floor_tournament_clock_controlled");
    const clockControlSignature = String.raw`UUID,\s*TEXT,\s*INTEGER,\s*TEXT`;
    expect(clockControlMigration).toMatch(
      new RegExp(
        String.raw`REVOKE ALL ON FUNCTION public\.floor_control_tournament_clock\(\s*${clockControlSignature}\s*\) FROM PUBLIC, anon, service_role;`,
      ),
    );
    expect(clockControlMigration).toMatch(
      new RegExp(
        String.raw`GRANT EXECUTE ON FUNCTION public\.floor_control_tournament_clock\(\s*${clockControlSignature}\s*\) TO authenticated;`,
      ),
    );
    expect(clockControlMigration).not.toMatch(/CREATE POLICY[\s\S]*ON public\.tournaments/i);
    expect(clockControlMigration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.floor_control_tournament_clock\([\s\S]*?\) TO service_role;/,
    );
  });

  it("binds Floor operator scope to auth.uid and real club memberships", () => {
    expect(operatorScopeMigration).toContain("auth.uid()");
    expect(operatorScopeMigration).toContain("clubs.owner_id");
    expect(operatorScopeMigration).toContain("public.club_cashiers");
    expect(operatorScopeMigration).toContain("public.club_floors");
    expect(operatorScopeMigration).not.toContain("public.user_roles");
    expect(operatorScopeMigration).toContain("REVOKE ALL ON FUNCTION public.get_my_floor_operator_scope() FROM PUBLIC, anon");
    expect(operatorScopeMigration).toContain("GRANT EXECUTE ON FUNCTION public.get_my_floor_operator_scope() TO authenticated");
  });

  it("uses caller-bound capability scope in Floor UI and Edge handlers", () => {
    expect(operatorClubsHook).toContain('supabase.rpc("get_my_floor_operator_scope")');
    expect(operatorClubsHook).not.toContain('supabase.rpc("cashier_club_ids"');
    expect(operatorClubsHook).not.toContain('supabase.rpc("floor_club_ids"');
    expect(opsShell).toContain("hasOpsAccess");
    expect(cashierAccess).toContain("hasCashierAccess");
    expect(desktopFloor).toContain("operatorClubIds");
    expect(desktopFloor).toContain("Array.from(new Set([...operatorClubIds, ...dealerClubIds]))");
    expect(desktopFloor).not.toContain("{ clubs, clubIds, dealerClubIds }");
    expect(desktopFloor).not.toContain("clubIds.length === 0");
    expect(desktopFloor).toContain('<TournamentLivePanel mode="floor" clubIds={scopedIds} clubs={clubs} />');
    expect(floorTableMap).toContain('supabase.rpc("get_my_floor_operator_scope")');
    expect(floorTableMap).toContain("row.can_owner || row.can_cashier || row.can_floor");
    expect(floorTableMap).not.toContain('supabase.rpc("cashier_club_ids"');
    expect(floorTableMap).toContain("supabase.rpc.bind(supabase)");
    expect(playersGrouped).toContain('supabase.rpc("get_my_floor_operator_scope")');
    expect(playersGrouped).toContain("row.can_owner || row.can_cashier || row.can_floor");
    expect(playersGrouped).not.toContain('supabase.rpc("cashier_club_ids"');

    for (const edge of [drawEdge, clockEdge]) {
      expect(edge).toContain("supabase.auth.getUser()");
      expect(edge).toContain('supabase.rpc("get_my_floor_operator_scope")');
      expect(edge).not.toContain('supabase.rpc("floor_club_ids"');
      expect(edge).not.toContain('supabase.rpc("cashier_club_ids"');
      expect(edge).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(edge).not.toMatch(
        /response\(\{\s*error:\s*(?:error\.)?(?:message|details?|hint)\b/,
      );
    }
    expect(drawEdge).toContain("body.seats.length !== 1");
    expect(drawEdge).toContain("expected_chip_count");
    expect(editChipsDialog).toContain("expected_chip_count: seat.chip_count");
    expect(drawEdge).toMatch(/supabase\.rpc\(\s*"floor_bust_player"/);
    expect(drawEdge).toContain('error: "draw_operation_failed"');
    expect(clockEdge).toMatch(/supabase\.rpc\(\s*"floor_start_tournament_clock"/);
    expect(clockEdge).toMatch(/supabase\.rpc\(\s*"floor_control_tournament_clock"/);
    expect(clockEdge).toContain("readExpectedControlRevision(body)");
    expect(clockEdge).toContain("readLegacyControlRevision(");
    expect(clockEdge).toContain("p_expected_control_revision: expectedControlRevision");
    expect(clockEdge).not.toContain("p_expected_current_level");
    expect(clockEdge).not.toContain("p_expected_clock_started_at");
    expect(clockEdge).not.toContain("p_expected_clock_paused_at");
    expect(clockEdge).toContain("isTerminalTournamentStatus(tournament.status)");
    expect(clockEdge).not.toMatch(/\.from\("tournaments"\)\s*\.update/);
    expect(clockEdge).not.toContain("stale_clock_state");
    expect(clockEdge).toContain('error: "clock_operation_failed"');
    for (const ui of [clockPanel, opsCockpit]) {
      expect(ui).toContain("expected_control_revision: expectedControlRevision");
      expect(ui).toContain("canUseTournamentClockPostStartControls");
      expect(
        ui.includes("await loadClock()") || ui.includes("await Promise.all([loadClk()"),
      ).toBe(true);
    }
  });

  it("keeps the applied cleanup index as a standalone idempotent source contract", () => {
    expect(cleanupIndexMigration).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS");
    expect(cleanupIndexMigration).toContain("idx_dealer_rotation_schedule_table_id");
    expect(cleanupIndexMigration).toContain("ON public.dealer_rotation_schedule (table_id)");
    expect(cleanupIndexMigration).not.toMatch(/\bBEGIN\b\s*;/i);
    expect(cleanupIndexMigration).not.toMatch(/\bCOMMIT\b\s*;/i);
  });

  it("routes Floor chip CAS through one caller-bound, column-narrow RPC", () => {
    expect(chipCasMigration).toContain("CREATE OR REPLACE FUNCTION public.floor_update_tournament_seat_chip");
    expect(chipCasMigration).toContain("v_actor UUID := auth.uid()");
    expect(chipCasMigration).toContain("SECURITY DEFINER");
    expect(chipCasMigration).toContain("SET search_path = public");
    expect(chipCasMigration).toContain("FROM public.club_floors cf");
    expect(chipCasMigration).toContain("FOR UPDATE");
    expect(chipCasMigration).toContain("AND chip_count = p_expected_chip_count");
    expect(chipCasMigration).toMatch(/UPDATE public\.tournament_seats\s+SET chip_count = p_chip_count/);
    expect(chipCasMigration).not.toMatch(/CREATE POLICY[\s\S]*tournament_seats/i);
    expect(chipCasMigration).toContain("REVOKE ALL ON FUNCTION public.floor_update_tournament_seat_chip");
    expect(chipCasMigration).not.toMatch(/TO authenticated, service_role;/);
    expect(drawEdge).toMatch(/supabase\.rpc\(\s*"floor_update_tournament_seat_chip"/);
    expect(drawEdge).not.toMatch(/\.from\("tournament_seats"\)\s*\.update\(\{ chip_count:/);
  });
});
