import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20270114000005_assign_dealer_floor_v3_session_compat.sql"),
  "utf8",
);
const disposable = readFileSync(
  resolve(root, "tests/dealerAssignmentSessionCompat/disposableDb.sql"),
  "utf8",
);
const workflow = readFileSync(
  resolve(root, "../.github/workflows/assign-dealer-session-compat-db.yml"),
  "utf8",
);
const concurrency = readFileSync(
  resolve(root, "tests/dealerAssignmentSessionCompat/runConcurrency.sh"),
  "utf8",
);

describe("canonical Dealer assignment Floor V3 session compatibility", () => {
  it("preserves the production 10-parameter ABI and current security shape", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.assign_dealer_to_table(");
    expect(migration).toContain("p_override         BOOLEAN DEFAULT false");
    expect(migration).toContain("p_override_reason  TEXT DEFAULT NULL");
    expect(migration).toContain("p_actor            UUID DEFAULT NULL");
    expect(migration).toContain("RETURNS JSONB");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = public");
    expect(migration).not.toContain("p_table_session_id");
    expect(migration).not.toMatch(/DROP\s+FUNCTION/i);
  });

  it("derives physical-table club and implements the exact zero/one/many contract", () => {
    expect(migration).toContain("FROM public.game_tables table_row");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("table_club_mismatch");
    expect(migration).toContain("FROM public.table_sessions session_row");
    expect(migration).toContain("session_row.game_table_id = p_table_id");
    expect(migration).toContain("session_row.closed_at IS NULL");
    expect(migration).toContain("IF v_active_session_count > 1 THEN");
    expect(migration).toContain("table_session_ambiguous");
    expect(migration).toContain("v_table_session_id := NULL");
    expect(migration).toMatch(/INSERT INTO public\.dealer_assignments \([\s\S]*?table_session_id[\s\S]*?v_table_session_id/);
    expect(migration).not.toMatch(/UPDATE\s+public\.dealer_assignments[\s\S]*?SET\s+table_session_id/i);
  });

  it("binds idempotency to the current session identity without rewriting history", () => {
    expect(migration).toContain("assignment_row.table_session_id");
    expect(migration).toContain("v_existing_table_session_id IS DISTINCT FROM v_table_session_id");
    expect(migration).toContain("idempotency_mismatch");
    expect(migration).toContain("Historical rows are never rewritten");
  });

  it("keeps the permanent PostgreSQL 17 regression in CI", () => {
    expect(disposable).toContain("CANONICAL_ASSIGNMENT_SESSION_COMPAT=PASS");
    expect(disposable).toContain("ZERO_SESSION_ASSIGN=PASS");
    expect(disposable).toContain("ONE_SESSION_EXACT_BIND=PASS");
    expect(disposable).toContain("MULTIPLE_SESSION_REJECT=PASS");
    expect(disposable).toContain("LEGACY_KEY_AFTER_SESSION=PASS");
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain("tests/dealerAssignmentSessionCompat/disposableDb.sql");
    expect(workflow).toContain("tests/dealerAssignmentSessionCompat/runConcurrency.sh");
    expect(concurrency).toContain("ASSIGN_VS_OPEN=PASS");
    expect(concurrency).toContain("ASSIGN_VS_CLOSE=PASS");
    expect(concurrency).toContain("ASSIGN_VS_RELEASE=PASS");
    expect(concurrency).toContain("DOUBLE_ASSIGN=PASS");
    expect(workflow).not.toMatch(/db push|functions deploy|vercel --prod|orlesggcjamwuknxwcpk/i);
  });
});
