import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20270108000002_tracker_unified_ops_v2_context_safe_start.sql";
const migrationPath = resolve(process.cwd(), "supabase", "migrations", migrationName);
const migration = readFileSync(migrationPath, "utf8");

describe("Tracker Unified Ops V2 PR2A migration contract", () => {
  it("uses one unique migration version after the repository maximum", () => {
    const migrationNames = readdirSync(resolve(process.cwd(), "supabase", "migrations"));
    expect(migrationNames.filter((name) => name.startsWith("20270108000002_"))).toEqual([
      migrationName,
    ]);
  });

  it("adds immutable hand context snapshots and a lock version", () => {
    expect(migration).toContain("tracker_context_version TEXT");
    expect(migration).toContain("tracker_level_id UUID");
    expect(migration).toContain("tracker_level_number INTEGER");
    expect(migration).toContain("tracker_small_blind INTEGER");
    expect(migration).toContain("tracker_big_blind INTEGER");
    expect(migration).toContain("tracker_bba INTEGER");
    expect(migration).toContain("tracker_is_break BOOLEAN");
    expect(migration).toContain("tracker_lock_version BIGINT");
    expect(migration).toContain("trg_tracker_unified_ops_lock_version");
  });

  it("exposes only the PR2A context/list/start RPCs", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.list_tracker_tables_v2\(p_tournament_id UUID\)/,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_tracker_table_context_v2\(/,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.start_tracker_hand_v2\(/,
    );
    expect(migration).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.(floor_correct_tracker_stack_between_hands|ack_tracker_stack_correction|void_tracker_hand_v2)\(/,
    );
  });

  it("keeps start server-authoritative and never delegates to legacy start_hand", () => {
    expect(migration).toContain("PERFORM public.tracker_unified_ops_lock_tournament");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("p_expected_context_version");
    expect(migration).toContain("p_idempotency_key");
    expect(migration).toContain("tracker_context_version");
    expect(migration).not.toMatch(/\bpublic\.start_hand\s*\(/);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+public\.hand_actions\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+public\.tournament_eliminations\b/i);
    expect(migration).not.toMatch(/SET\s+status\s*=\s*'voided'/i);
  });

  it("keeps private receipts inaccessible and RPCs authenticated-only", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.tracker_unified_ops_receipts");
    expect(migration).toContain(
      "REVOKE ALL ON public.tracker_unified_ops_receipts",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.start_tracker_hand_v2(UUID, UUID, INTEGER, TEXT, TEXT)",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.start_tracker_hand_v2(UUID, UUID, INTEGER, TEXT, TEXT)",
    );
  });
});
