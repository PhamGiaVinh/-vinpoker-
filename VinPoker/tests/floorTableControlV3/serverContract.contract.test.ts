import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20270113000003_floor_table_control_v3_server_contract.sql"),
  "utf8",
);
const disposable = readFileSync(
  resolve(root, "tests/floorTableControlV3/disposableDb.serverContract.sql"),
  "utf8",
);
const workflow = readFileSync(
  resolve(root, "../.github/workflows/floor-table-control-v3-contract-disposable-db.yml"),
  "utf8",
);

describe("Floor Table Control V3 server contract", () => {
  it("transitions the historical permanent physical-table uniqueness only after exact explicit mapping", () => {
    expect(migration).toContain("floor_table_v3_legacy_assignment_preflight_failed");
    expect(migration).toContain("tt.table_id IS NOT NULL");
    expect(migration).toContain("table_session_id IS NULL");
    expect(migration).toContain("uq_tournament_tables_one_session_v3");
    expect(migration).toContain("ALTER COLUMN table_id DROP NOT NULL");
    expect(migration).toContain("ALTER TABLE public.tournament_tables DROP CONSTRAINT %I");
    expect(migration).not.toMatch(/UPDATE\s+public\.tournament_(tables|seats|hands)\s+SET\s+table_id/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\./i);
  });

  it("keeps internal helpers non-callable and every public V3 RPC caller-bound", () => {
    expect(migration).toContain("CREATE SCHEMA IF NOT EXISTS floor_private");
    expect(migration).toContain("REVOKE ALL ON SCHEMA floor_private FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("REVOKE ALL ON FUNCTION floor_private.floor_table_v3_assert_tracker_context");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("game_table_scope_mismatch");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.floor_open_tournament_table_v3");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v3");
  });

  it("makes physical-table leases, mode fencing, revisions and durable receipts explicit", () => {
    expect(migration).toContain("game_table_in_use");
    expect(migration).toContain("control_epoch = control_epoch + 1");
    expect(migration).toContain("STALE_TRACKER_CONTEXT");
    expect(migration).toContain("STALE_STATE");
    expect(migration).toContain("IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("floor_table_v3_lock_receipt");
    expect(migration).toContain("floor_table_v3_save_receipt");
    expect(migration).toContain("ORDER BY gt.id FOR UPDATE");
    expect(migration).toContain("ORDER BY session_row.id FOR UPDATE");
  });

  it("uses entry-backed V3 roster mutations without a money or legacy-table writer", () => {
    expect(migration).toContain("registration_id IS NULL");
    expect(migration).toContain("entry_not_seatable");
    expect(migration).toContain("payout_applied', false");
    expect(migration).toContain("player_has_chips");
    expect(migration).toContain("manual_nonzero_chip_override");
    expect(migration).toContain("floor_break_table_v3");
    expect(migration).toContain("close_tournament_table_v3");
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\.tournament_(tables|seats|hands)\s*\([\s\S]*?\n\s*table_id\s*[,)]/i);
    expect(migration).not.toMatch(/sepay|staking|buy.?in|prize_payment/i);
  });

  it("proves lifecycle, fencing, ACL and cross-club paths in an isolated PostgreSQL 17 database", () => {
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain("tests/floorTableControlV3/disposableDb.serverContract.sql");
    expect(workflow).toContain("vitest.serverContract.config.ts");
    expect(workflow).not.toMatch(/db push|functions deploy|vercel --prod|orlesggcjamwuknxwcpk/i);
    expect(disposable).toContain("FLOOR_TABLE_CONTROL_V3_SERVER_CONTRACT_DISPOSABLE_PASS");
    expect(disposable).toContain("same idempotency request returns the original open result");
    expect(disposable).toContain("pre-mode-change Tracker context is fenced");
    expect(disposable).toContain("Tracker request from a closed session is fenced after physical-table reuse");
    expect(disposable).toContain("move leaves no ghost seat in the former table");
    expect(disposable).toContain("break ends the dealer assignment and session history together");
    expect(disposable).toContain("authenticated Floor cannot open another club physical table");
  });
});
