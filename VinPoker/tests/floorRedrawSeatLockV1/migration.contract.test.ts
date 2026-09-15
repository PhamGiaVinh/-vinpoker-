import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270114000011_floor_redraw_seat_lock_v1.sql"),
  "utf8",
);

describe("Floor redraw and seat-lock V1 migration contract", () => {
  it("keeps redraw history server-owned and stores an immutable source snapshot", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.tournament_redraw_batches");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.tournament_redraw_moves");
    expect(migration).toContain("entry_number integer NOT NULL");
    expect(migration).toContain("chip_count integer NOT NULL");
    expect(migration).toContain("snapshot_fingerprint");
    expect(migration).toContain("state_changed_after_preview");
    expect(migration).toContain("ORDER BY slot_no, gt.table_number, gt.id");
    expect(migration).toContain("UNIQUE (batch_id, entry_id)");
    expect(migration).toContain("UNIQUE (batch_id, to_game_table_id, to_seat_number)");
    expect(migration).toContain("REVOKE ALL ON TABLE public.tournament_redraw_batches FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("REVOKE ALL ON TABLE public.tournament_redraw_moves FROM PUBLIC, anon, authenticated");
  });

  it("returns only current-tournament or unleased physical tables to the picker", () => {
    const inventory = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.get_floor_tournament_table_inventory_v1"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.get_floor_tournament_table_roster_v4"),
    );
    expect(inventory).toContain("any_session.id IS NULL OR current_session.id IS NOT NULL");
    expect(inventory).toContain("current_tournament");
    expect(inventory).not.toContain("other_tournament");
    expect(inventory).not.toContain("'cash'");
    expect(inventory).not.toContain("'vip'");
  });

  it("enforces caller-bound seat locks and lock-aware roster writers", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.table_session_seat_locks");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.floor_set_table_seat_lock_v1");
    expect(migration).toContain("seat_locked");
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("floor_table_v3_actor_is_tournament_operator");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.floor_assign_entry_to_seat_v4");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.move_player_seat_v3");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.floor_restore_busted_player_to_seat_v4");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.close_tournament_table_v4");
    expect(migration).toContain("unlock_reason = COALESCE(unlock_reason, 'table_closed')");
  });

  it("applies swaps in two phases and fences Tracker sessions after redraw", () => {
    const apply = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.floor_apply_tournament_redraw_v1"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.get_public_tournament_redraw_v1"),
    );
    const releaseIndex = apply.indexOf("UPDATE public.tournament_seats seat_row");
    const insertIndex = apply.indexOf("INSERT INTO public.tournament_seats");
    expect(releaseIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(releaseIndex);
    expect(apply).toContain("v_released_count <> v_planned_count");
    expect(apply).toContain("control_epoch = CASE WHEN control_mode = 'tracker' THEN control_epoch + 1");
    expect(apply).toContain("NOT (game_table_id = ANY(v_batch.target_game_table_ids))");
  });

  it("fails closed to redraw when break-table legacy capacity assumptions are unsafe", () => {
    const breakWriter = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.floor_break_table_v4"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.floor_plan_tournament_redraw_v1"),
    );
    expect(breakWriter).toContain("tt.max_seats <> 9");
    expect(breakWriter).toContain("lock_row.unlocked_at IS NULL");
    expect(breakWriter).toContain("redraw_required_for_capacity_or_locks");
    expect(breakWriter).toContain("public.floor_break_table_v3");
  });

  it("exposes only the sanitized TV read while keeping operator mutations authenticated", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_public_tournament_redraw_v1");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_public_tournament_redraw_v1(uuid) TO anon, authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.floor_apply_tournament_redraw_v1(uuid, uuid) TO authenticated");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.floor_apply_tournament_redraw_v1(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).not.toMatch(/sepay|staking|buy.?in|prize_payment|payroll/i);
  });
});
