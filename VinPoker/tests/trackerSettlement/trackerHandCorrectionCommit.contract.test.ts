import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20270115000002_tracker_hand_correction_commit_receipt.sql");
const edge = read("supabase/functions/tournament-live-resettle-commit/index.ts");

describe("Tracker atomic hand correction commit contract", () => {
  it("keeps correction audit and the writer behind a service-role-only wrapper", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS correction_reason text");
    expect(migration).toContain("tracker_hand_correction_commit_dependency_missing");
    expect(migration).toContain("trg_guard_tracker_blind_post_amount");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.commit_tracker_hand_correction_outcome");
    expect(migration).toContain("service_role_only");
    expect(migration).toContain("commit_tournament_settlement_outcome");
    expect(migration).toContain("WHERE hand_id = p_hand_id");
    expect(migration).toContain("AND idempotency_key = p_idempotency_key");
    expect(migration).toContain("correction_reason_recorded");
    expect(migration).toContain("TO service_role");
    expect(migration).not.toContain("TO authenticated");
  });

  it("recomputes, verifies the exact ending stacks, and returns only a redacted receipt", () => {
    expect(edge).toContain("computeAuthoritativeSettlement");
    expect(edge).toContain("assertExpectedTargetEndingStacks");
    expect(edge).toContain("commit_tracker_hand_correction_outcome");
    expect(edge).toContain("redactedTargetEndingStacks");
    expect(edge).toContain("authorize_tournament_live_resettle");
    expect(edge).not.toContain("apply_resettle_forward");
    expect(edge).not.toContain("holeCardsByPlayer");
  });
});
