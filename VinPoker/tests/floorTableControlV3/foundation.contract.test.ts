import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20270113000002_floor_table_control_v3_foundation.sql"),
  "utf8",
);
const disposable = readFileSync(
  resolve(root, "tests/floorTableControlV3/disposableDb.foundation.sql"),
  "utf8",
);
const workflow = readFileSync(
  resolve(root, "../.github/workflows/floor-table-control-v3-disposable-db.yml"),
  "utf8",
);

describe("Floor Table Control V3 additive foundation", () => {
  it("adds explicit identities without rewriting legacy table_id semantics", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.table_sessions");
    expect(migration).toContain("tournament_tables_game_table_id_v3_fkey");
    expect(migration).toContain("tournament_seats_tournament_table_id_v3_fkey");
    expect(migration).toContain("tournament_hands_table_session_id_v3_fkey");
    expect(migration).toContain("Legacy placement cache only during Floor Table Control V3 transition");
    expect(migration).toContain("tournament_tables_session_game_table_v3_fkey");
    expect(migration).toContain("tournament_seats_table_session_match_v3_fkey");
    expect(migration).toContain("dealer_assignments_session_game_table_v3_fkey");
    expect(migration.indexOf("uq_tournament_tables_id_tournament_v3")).toBeLessThan(
      migration.indexOf("tournament_seats_table_tournament_v3_fkey"),
    );
    expect(migration.indexOf("uq_tournament_tables_id_session_v3")).toBeLessThan(
      migration.indexOf("tournament_seats_table_session_match_v3_fkey"),
    );
    expect(migration).not.toMatch(/ALTER\s+COLUMN\s+table_id\s+TYPE/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.tournament_(seats|tables|hands)\s+SET\s+table_id/i);
  });

  it("contains the physical inventory, lifecycle and seat invariants in the database", () => {
    expect(migration).toContain("uq_game_tables_club_table_number_v3");
    expect(migration).toContain("table_number BETWEEN 1 AND 100");
    expect(migration).toContain("uq_table_sessions_one_active_game_table");
    expect(migration).toContain("WHERE closed_at IS NULL");
    expect(migration).toContain("uq_tournament_seats_active_entry_v3");
    expect(migration).toContain("uq_tournament_seats_active_explicit_seat_v3");
  });

  it("preserves fencing and idempotency storage as private server-side contracts", () => {
    expect(migration).toContain("control_epoch bigint NOT NULL DEFAULT 1");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.table_operation_receipts");
    expect(migration).toContain("PRIMARY KEY (actor_id, operation_type, request_id)");
    expect(migration).toContain("request_fingerprint text NOT NULL");
    expect(migration).toContain("REVOKE ALL ON TABLE public.table_operation_receipts FROM PUBLIC, anon, authenticated");
  });

  it("keeps preflight caller-bound and repair-oriented", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("OWNER TO postgres");
    expect(migration).toContain("LEGACY_OPERATIONAL_STATUS_UNMAPPED");
    expect(migration).toContain("ACTIVE_SEAT_EXPLICIT_LINK_MISSING");
    expect(migration).toContain("LEGACY_TOURNAMENT_TABLE_UNMAPPED");
    expect(migration).toContain("LEGACY_TOURNAMENT_TABLE_UNIQUE_TABLE_ID_PREREQUISITE");
    expect(migration).not.toContain("operational_status text NOT NULL DEFAULT 'available'");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\./i);
  });

  it("uses a disposable PostgreSQL 17 suite with no production connection", () => {
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain("tests/floorTableControlV3/disposableDb.foundation.sql");
    expect(workflow).not.toMatch(/db push|functions deploy|vercel --prod|orlesggcjamwuknxwcpk/i);
    expect(disposable).toContain("FLOOR_TABLE_CONTROL_V3_FOUNDATION_DISPOSABLE_PASS");
    expect(disposable).toContain("expected active session lease constraint");
    expect(disposable).toContain("expected session/game-table pairing constraint");
    expect(disposable).toContain("expected legacy tournament_tables table_id unique prerequisite");
    expect(disposable).toContain("floor_table_v3_assert_permission_denied");
    expect(disposable).toContain("Floor membership can execute caller-bound preflight");
    expect(disposable).toContain("Dealer Control membership can execute caller-bound preflight");
    expect(disposable).toContain("unrelated actor receives no cross-club preflight metadata");
  });
});
