import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20270113000003_floor_table_control_v3_server_contract.sql"),
  "utf8",
);
const hardeningMigration = readFileSync(
  resolve(root, "supabase/migrations/20270113000005_floor_table_control_v3_contract_hardening.sql"),
  "utf8",
);
const rosterMigration = readFileSync(
  resolve(root, "supabase/migrations/20270113000006_floor_table_control_v3_roster_read_contract.sql"),
  "utf8",
);
const previewOnlyWriterGrants = readFileSync(
  resolve(root, "tests/floorTableControlV3/previewOnlyWriterGrants.sql"),
  "utf8",
);
const disposable = readFileSync(
  resolve(root, "tests/floorTableControlV3/disposableDb.serverContract.sql"),
  "utf8",
);
const authenticatedDisposable = readFileSync(
  resolve(root, "tests/floorTableControlV3/disposableDb.serverContract.authenticated.sql"),
  "utf8",
);
const concurrencySetup = readFileSync(
  resolve(root, "tests/floorTableControlV3/disposableDb.serverContract.concurrent.setup.sql"),
  "utf8",
);
const concurrencyRunner = readFileSync(
  resolve(root, "tests/floorTableControlV3/runServerContractConcurrency.sh"),
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
    expect(hardeningMigration).toContain("REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid) FROM authenticated");
    expect(hardeningMigration).toContain("floor_table_v3_guard_dealer_assignment_session");
    const dealerAssignmentGuard = hardeningMigration.slice(
      hardeningMigration.indexOf("CREATE OR REPLACE FUNCTION floor_private.floor_table_v3_guard_dealer_assignment_session"),
      hardeningMigration.indexOf("DROP TRIGGER IF EXISTS floor_table_v3_guard_dealer_assignment_session"),
    );
    expect(dealerAssignmentGuard).toContain("FOR KEY SHARE");
    expect(hardeningMigration).toContain("FOR SHARE");
    expect(dealerAssignmentGuard.indexOf("FOR KEY SHARE")).toBeLessThan(
      dealerAssignmentGuard.indexOf("FOR SHARE"),
    );
    expect(hardeningMigration).toContain("floor_table_v3_dealer_assignment_session_not_active");
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

    const breakWriter = hardeningMigration.slice(
      hardeningMigration.indexOf("CREATE OR REPLACE FUNCTION public.floor_break_table_v3"),
      hardeningMigration.indexOf("ALTER FUNCTION public.floor_break_table_v3"),
    );
    expect(breakWriter).toContain("JOIN public.game_tables gt ON gt.id = session_row.game_table_id");
    expect(breakWriter).toContain("ORDER BY gt.id, session_row.id");
    expect(breakWriter).not.toContain("ORDER BY session_row.id FOR UPDATE");
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

  it("adds a caller-bound canonical active-session roster without guessing legacy ids", () => {
    expect(rosterMigration).toContain("get_floor_tournament_table_roster_v3");
    expect(rosterMigration).toContain("get_floor_restorable_entries_v3");
    expect(rosterMigration).toContain("seat_row.tournament_table_id = table_row.id");
    expect(rosterMigration).toContain("seat_row.table_session_id = session_row.id");
    expect(rosterMigration).toContain("session_row.closed_at IS NULL");
    expect(rosterMigration).toContain("floor_table_v3_roster_access_denied");
    expect(rosterMigration).toContain("SET search_path = ''");
    expect(rosterMigration).not.toMatch(/UPDATE\s+public\.|DELETE\s+FROM\s+public\./i);
    expect(rosterMigration).not.toMatch(/legacy\s+table_id.*=/i);
  });

  it("keeps V3 writers revoked in the active catalog and confines test grants", () => {
    expect(hardeningMigration).toContain("REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid) FROM authenticated");
    expect(hardeningMigration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.floor_open_tournament_table_v3/i);
    expect(previewOnlyWriterGrants).toContain("Preview/disposable-only authenticated writer grants");
    expect(previewOnlyWriterGrants).toContain("GRANT EXECUTE ON FUNCTION public.floor_open_tournament_table_v3");
    expect(previewOnlyWriterGrants).toContain("GRANT EXECUTE ON FUNCTION public.floor_restore_busted_player_to_seat_v3");
    expect(previewOnlyWriterGrants).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE)\s+ON\s+TABLE/i);
    expect(previewOnlyWriterGrants).not.toMatch(/GRANT\s+USAGE\s+ON\s+SCHEMA/i);
  });

  it("proves lifecycle, fencing, ACL, authenticated callers and real races in isolated PostgreSQL 17", () => {
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain("tests/floorTableControlV3/disposableDb.serverContract.sql");
    expect(workflow).toContain("disposableDb.serverContract.authenticated.sql");
    expect(workflow).toContain("disposableDb.serverContract.concurrent.setup.sql");
    expect(workflow).toContain("runServerContractConcurrency.sh");
    expect(workflow).toContain("vitest.serverContract.config.ts");
    expect(workflow).not.toMatch(/db push|functions deploy|vercel --prod|orlesggcjamwuknxwcpk/i);
    expect(disposable).toContain("FLOOR_TABLE_CONTROL_V3_SERVER_CONTRACT_DISPOSABLE_PASS");
    expect(disposable).toContain("20270113000006_floor_table_control_v3_roster_read_contract.sql");
    expect(authenticatedDisposable).toContain("previewOnlyWriterGrants.sql");
    expect(disposable).toContain("same idempotency request returns the original open result");
    expect(disposable).toContain("pre-mode-change Tracker context is fenced");
    expect(disposable).toContain("Tracker request from a closed session is fenced after physical-table reuse");
    expect(disposable).toContain("move leaves no ghost seat in the former table");
    expect(disposable).toContain("break ends the dealer assignment and session history together");
    expect(disposable).toContain("authenticated Floor cannot open another club physical table");
    expect(disposable).toContain("expected V3 dealer assignment guard for a closed session");
    expect(authenticatedDisposable).toContain("SET LOCAL ROLE authenticated");
    expect(authenticatedDisposable).toContain("FLOOR_TABLE_CONTROL_V3_AUTHENTICATED_CALLER_PASS");
    expect(authenticatedDisposable).toContain("authenticated cross-club access was not denied");
    expect(concurrencySetup).toContain("Dedicated exact-ID fixtures for real multi-connection races");
    expect(concurrencyRunner).toContain("same-seat race");
    expect(concurrencyRunner).toContain("move-vs-bust race");
    expect(concurrencyRunner).toContain("close-vs-dealer assignment race");
    expect(concurrencyRunner).toContain("SET LOCAL ROLE authenticated");
    expect(concurrencyRunner).toContain("deadlock_or_lock_timeout");
    expect(concurrencyRunner).toContain("floor_table_v3_dealer_assignment_session_not_active");
    expect(concurrencyRunner).toContain("grep -h -c");
    expect(concurrencyRunner).not.toContain("awk -F:");
  });
});
