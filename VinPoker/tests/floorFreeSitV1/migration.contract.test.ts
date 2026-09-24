import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "supabase/pending-migrations/20270115000004_floor_free_sit_v1.sql"),
  "utf8",
);

describe("Floor Free Sit V1 migration contract", () => {
  it("preserves stack and entry while releasing only the current seat", () => {
    expect(source).toContain("CREATE OR REPLACE FUNCTION public.floor_free_sit_player_v1");
    expect(source).toContain("SET status = 'registered'");
    expect(source).toContain("current_stack = v_seat.chip_count");
    expect(source).toContain("SET is_active = false");
    expect(source).toContain("status = 'free_sit'");
    expect(source).toContain("players_remaining_unchanged', true");
    expect(source).not.toMatch(/UPDATE\s+public\.tournaments\s+SET\s+players_remaining/i);
    expect(source).not.toMatch(/current_stack\s*=\s*0/i);
  });

  it("blocks stale, active-hand, cross-club and Tracker-divergent writes", () => {
    expect(source).toContain("floor_table_v3_actor_is_tournament_operator");
    expect(source).toContain("p_expected_revision");
    expect(source).toContain("p_expected_control_epoch");
    expect(source).toContain("p_expected_chip_count");
    expect(source).toContain("player_in_active_hand");
    expect(source).toContain("tracker_chip_state_mismatch");
    expect(source).toContain("game_table_scope_mismatch");
    expect(source).toContain("entry_not_free_sittable");
    expect(source).toContain("v_entry.registration_id IS NULL");
  });

  it("is idempotent, invalidates the old receipt and never touches money or payout", () => {
    expect(source).toContain("floor_table_v3_lock_receipt");
    expect(source).toContain("floor_table_v3_existing_receipt");
    expect(source).toContain("IDEMPOTENCY_CONFLICT");
    expect(source).toContain("SET status = 'superseded'");
    expect(source).toContain("payout_applied', false");
    expect(source).not.toMatch(/INSERT\s+INTO\s+public\.tournament_registrations/i);
    expect(source).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?:sepay|staking|prize_payment|revenue)/i);
  });

  it("uses a caller-bound SECURITY DEFINER function with least privilege", () => {
    expect(source).toContain("SECURITY DEFINER");
    expect(source).toContain("SET search_path = ''");
    expect(source).toContain("v_actor uuid := auth.uid()");
    expect(source).toContain("FROM PUBLIC, anon, service_role");
    expect(source).toContain("TO authenticated");
  });
});
