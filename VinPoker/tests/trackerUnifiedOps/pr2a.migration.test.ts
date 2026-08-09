import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20270108000003_tracker_unified_ops_v2_context_safe_start.sql";
const migrationPath = resolve(process.cwd(), "supabase", "migrations", migrationName);
const migration = readFileSync(migrationPath, "utf8");

describe("Tracker Unified Ops V2 PR2A migration contract", () => {
  it("uses one unique migration version after the repository maximum", () => {
    const migrationNames = readdirSync(resolve(process.cwd(), "supabase", "migrations"));
    expect(migrationNames.filter((name) => name.startsWith("20270108000003_"))).toEqual([
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

  it("keeps canonical seat, physical entry, and compatible hand identity domains", () => {
    expect(migration).toContain("AND s.table_id = v_tt.id");
    expect(migration).not.toContain("AND s.table_id = v_tt.table_id");
    expect(migration).toContain(
      "AND e.table_id IS NOT DISTINCT FROM v_tt.table_id",
    );
    expect(migration).not.toMatch(
      /e\.table_id IS (?:NOT )?DISTINCT FROM s\.table_id/,
    );
    expect(migration).toContain("AND h.table_id IN (v_tt.id, v_tt.table_id)");
    expect(migration).toMatch(/v_tt\.id,\r?\n\s+v_hand_number/);
  });

  it("requires canonical entry seat identity and blocks wrong-seat entries", () => {
    expect(
      migration.match(/AND e\.seat_number IS NOT DISTINCT FROM s\.seat_number/g),
    ).toHaveLength(4);
    expect(migration).toContain(
      "OR e.seat_number IS DISTINCT FROM s.seat_number",
    );
  });

  it("hashes raw level and stack state without normalizing null, zero, or negatives", () => {
    const levelHashStart = migration.indexOf("v_level_hash_json := jsonb_build_object");
    const rosterHashStart = migration.indexOf("INTO v_roster_hash");
    const levelHashEndMatch = /SELECT COALESCE\(jsonb_agg\(x\.row_json ORDER BY x\.seat_number, x\.seat_id\), '\[\]'::JSONB\)\r?\n\s+INTO v_roster/.exec(
      migration.slice(levelHashStart),
    );
    const levelHashEnd = levelHashEndMatch
      ? levelHashStart + levelHashEndMatch.index
      : -1;
    const readinessStart = migration.search(
      /SELECT count\(\*\)::INTEGER\r?\n\s+INTO v_valid_roster_count/,
    );
    expect(levelHashStart).toBeGreaterThan(-1);
    expect(levelHashEnd).toBeGreaterThan(levelHashStart);
    expect(rosterHashStart).toBeGreaterThan(levelHashStart);
    expect(readinessStart).toBeGreaterThan(rosterHashStart);
    const levelHashSection = migration.slice(levelHashStart, levelHashEnd);
    const rosterHashSection = migration.slice(rosterHashStart, readinessStart);
    expect(levelHashSection).not.toMatch(/GREATEST\s*\(/i);
    expect(levelHashSection).not.toMatch(/COALESCE\s*\(/i);
    expect(rosterHashSection).not.toMatch(/GREATEST\s*\(/i);
    expect(rosterHashSection).toContain("'tracker_stack', tcc.chip_count");
    expect(rosterHashSection).toContain("'entry_stack', e.current_stack");
  });

  it("looks up a matching receipt before terminal tournament validation", () => {
    const start = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.start_tracker_hand_v2(",
    );
    const end = migration.indexOf(
      "REVOKE ALL ON FUNCTION public.start_tracker_hand_v2(",
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const startFunction = migration.slice(start, end);
    const receiptLookup = startFunction.indexOf(
      "SELECT r.* INTO v_existing",
    );
    const terminalStatusCheck = startFunction.indexOf(
      "IF v_tour.status IN ('completed', 'cancelled') THEN",
    );
    expect(receiptLookup).toBeGreaterThan(-1);
    expect(terminalStatusCheck).toBeGreaterThan(receiptLookup);
  });

  it("preserves current start semantics and level/button rules", () => {
    expect(migration).toContain("v_tour.status IN ('completed', 'cancelled')");
    expect(migration).not.toContain("v_tour.status IN ('finished', 'cancelled')");
    expect(migration).toContain("tt.max_seats");
    expect(migration).toContain("IF p_button_seat > v_tt.max_seats THEN");
    expect(migration).not.toMatch(/jsonb_array_elements\(v_context->'roster'\).*p_button_seat/s);
    expect(migration).toMatch(/starting_stack,\r?\n\s+ending_stack,/);
    expect(migration).toMatch(/\(r->>'seat_stack'\)::INTEGER,\r?\n\s+NULL,/);
    expect(migration).toContain("OR v_level.ante < 0");
    expect(migration).not.toContain("OR v_level.ante <= 0");
  });
});
