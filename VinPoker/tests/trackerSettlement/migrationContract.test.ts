import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261238000002_tracker_settlement_outcome_store.sql"), "utf8");

describe("Tracker settlement migration contract", () => {
  it("keeps the verified outcome write boundary service-role-only", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.tournament_settlement_outcomes");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.commit_tournament_settlement_outcome");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.commit_tournament_settlement_outcome");
    expect(migration).toContain("service_role_only");
    expect(migration).toContain("stale_source_revision");
    expect(migration).toContain("idempotency_mismatch");
  });

  it("keeps public projection separate from private settlement evidence", () => {
    expect(migration).toContain("get_public_tournament_settlement");
    expect(migration).toContain("private_field_in_public_outcome");
    expect(migration).toContain("p_public_outcome->'pots'");
    expect(migration).toContain("p_public_outcome->'players'");
  });

  it("does not depend on the later Live Center migration objects", () => {
    expect(migration).not.toMatch(/snapshot_hand_player_identity|get_public_tournament_clock_summary|bust_tournament_player_with_payout/);
  });
});
