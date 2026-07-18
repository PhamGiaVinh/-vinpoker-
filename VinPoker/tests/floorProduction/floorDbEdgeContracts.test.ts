import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20261240000000_floor_production_hardening.sql");
const clockMigration = read("supabase/migrations/20261241000000_floor_clock_start_atomic.sql");
const operatorScopeMigration = read("supabase/migrations/20261242000000_floor_operator_scope.sql");
const drawEdge = read("supabase/functions/tournament-live-draw/index.ts");
const clockEdge = read("supabase/functions/tournament-live-clock/index.ts");
const operatorClubsHook = read("src/hooks/useOperatorClubs.ts");
const opsShell = read("src/components/ops/OpsShell.tsx");
const cashierAccess = read("src/components/ops/OpsCashierAccess.tsx");

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
    expect(drawEdge).toMatch(/supabase\.rpc\(\s*"floor_bust_player"/);
    expect(drawEdge).toContain('error: "draw_operation_failed"');
    expect(clockEdge).toMatch(/supabase\.rpc\(\s*"floor_start_tournament_clock"/);
    expect(clockEdge).toContain("stale_clock_state");
    expect(clockEdge).toContain('error: "clock_operation_failed"');
  });
});
