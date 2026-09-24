import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270115000007_floor_break_eligible_destinations.sql"),
  "utf8",
);

describe("Floor V3 break eligible destinations", () => {
  it("counts and assigns only destinations without an active hand", () => {
    expect(source).toContain("CREATE OR REPLACE FUNCTION public.floor_break_table_v3");
    expect(source).toContain("floor_table_v3_has_active_hand(v_tournament.id, v_source_table.id, v_source_session.id)");
    expect(source).toContain("floor_table_v3_has_active_hand(");
    expect(source).toContain("floor_break_eligible_seats_v1(v_tournament.id, v_source_table.id)");
    expect(source).toContain("generate_series(1, target.max_seats)");
    expect(source).toContain("table_session_seat_locks");
    expect(source).toContain("floor_break_pending_reservations_v1");
    expect(source).not.toContain("sum(9 - occupied.count_active)");
    expect(source).not.toContain("destination_table_has_active_hand");
    expect(source).toContain("'insufficient_capacity'");
  });

  it("retains caller binding, locking, receipt, and atomic close semantics", () => {
    expect(source).toContain("auth.uid()");
    expect(source).toContain("floor_table_v3_actor_is_tournament_operator");
    expect(source).toContain("floor_table_v3_lock_receipt");
    expect(source).toContain("floor_table_v3_save_receipt");
    expect(source).toContain("ORDER BY gt.id, session_row.id");
    expect(source).toContain("SET closed_at = pg_catalog.now()");
  });
});
