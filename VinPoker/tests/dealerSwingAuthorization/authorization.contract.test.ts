import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationsDir = resolve(root, "supabase/migrations");
const authorizationMigrationName = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .find((name) => {
    const sql = readFileSync(resolve(migrationsDir, name), "utf8");
    return sql.includes("VP-AUDIT-001: Dealer Swing authorization containment");
  });

const migration = authorizationMigrationName
  ? readFileSync(resolve(migrationsDir, authorizationMigrationName), "utf8")
  : "";
const desktop = readFileSync(
  resolve(root, "src/components/cashier/DealerSwingTab.tsx"),
  "utf8",
);
const phone = readFileSync(resolve(root, "src/pages/ops/OpsDealerSwing.tsx"), "utf8");
const processSwing = readFileSync(
  resolve(root, "supabase/functions/process-swing/index.ts"),
  "utf8",
);
const dealerReady = readFileSync(
  resolve(root, "supabase/functions/process-swing-on-dealer-ready/index.ts"),
  "utf8",
);
const dealerReadyBackup = readFileSync(
  resolve(root, "supabase/functions/run-dealer-ready-backup/index.ts"),
  "utf8",
);

describe("Dealer Swing mutation authorization containment", () => {
  it("has one forward containment migration reserved by Migration Control", () => {
    expect(authorizationMigrationName).toBeTruthy();
    expect(migration).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(migration).not.toMatch(/DROP\s+(TABLE|FUNCTION)/i);
  });

  it("keeps every canonical mutation core private", () => {
    expect(migration).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.perform_swing\([\s\S]*?FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
    expect(migration).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.execute_pre_assigned_swing\([\s\S]*?FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
    expect(migration).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.execute_pre_assigned_swing_rpc\([\s\S]*?FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
    expect(migration).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.perform_swing\([\s\S]*?TO\s+service_role/i);
    expect(migration).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.execute_pre_assigned_swing_rpc\([\s\S]*?TO\s+service_role/i);
  });

  it("exposes one authenticated operator wrapper with server-derived authority", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.operator_perform_swing(");
    expect(migration).toContain("p_table_id uuid");
    expect(migration).toContain("p_table_session_id uuid");
    expect(migration).toContain("p_assignment_id uuid");
    expect(migration).toContain("p_expected_version integer");
    expect(migration).toContain("p_request_id uuid");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("public.is_club_dealer_control");
    expect(migration).toMatch(/FOR\s+UPDATE/i);
    expect(migration).toContain("TABLE_SESSION_BINDING_REQUIRED");
    expect(migration).toContain("TABLE_SESSION_STALE");
    expect(migration).toContain("SWING_OPERATOR_FORBIDDEN");
    expect(migration).toContain("SWING_INCOMING_CLUB_MISMATCH");
    expect(migration).toContain("SWING_INCOMING_ATTENDANCE_INVALID");
    expect(migration).toContain("public.dealer_swing_operator_requests");
    expect(migration).toContain("SWING_IDEMPOTENCY_CONFLICT");
    expect(migration).toMatch(/SET\s+search_path\s*=\s*''/i);
    expect(migration).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.operator_perform_swing\([\s\S]*?TO\s+authenticated/i);
    expect(migration).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.operator_perform_swing\([\s\S]*?FROM\s+PUBLIC\s*,\s*anon/i);
  });

  it("exposes exact-context worker wrappers to service_role only", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.worker_perform_swing(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.worker_execute_pre_assigned_swing(");
    expect(migration).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.worker_perform_swing\([\s\S]*?TO\s+service_role/i);
    expect(migration).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.worker_execute_pre_assigned_swing\([\s\S]*?TO\s+service_role/i);
    expect(migration).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.worker_perform_swing\([\s\S]*?FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
    expect(migration).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.worker_execute_pre_assigned_swing\([\s\S]*?FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
  });

  it("routes browser clients through the operator wrapper only", () => {
    expect(desktop).toContain('("operator_perform_swing"');
    expect(phone).toContain('("operator_perform_swing"');
    expect(desktop).not.toContain('supabase.rpc("perform_swing"');
    expect(phone).not.toContain('("perform_swing"');
  });

  it("routes trusted workers through exact-context worker wrappers", () => {
    expect(processSwing).toContain('rpc("worker_perform_swing"');
    expect(processSwing).toContain('"worker_execute_pre_assigned_swing"');
    expect(dealerReady).toContain('rpc("worker_perform_swing"');
    expect(dealerReadyBackup).toContain('rpc("worker_perform_swing"');

    for (const source of [processSwing, dealerReady, dealerReadyBackup]) {
      expect(source).not.toMatch(/\.rpc\(\s*["']perform_swing["']/);
      expect(source).not.toMatch(/\.rpc\(\s*["']execute_pre_assigned_swing_rpc["']/);
      expect(source).toContain("table_session_id");
    }
  });
});
