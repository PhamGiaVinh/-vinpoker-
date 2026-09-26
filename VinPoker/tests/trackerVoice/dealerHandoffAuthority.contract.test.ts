import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationName = "20270115000015_tracker_voice_dealer_handoff_authority.sql";
const migration = readFileSync(
  resolve(root, "supabase/migrations", migrationName),
  "utf8",
).replace(/\r\n/g, "\n");
const integration = readFileSync(
  resolve(root, "tests/trackerVoice/disposableDb.integration.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const workflow = readFileSync(
  resolve(root, "../.github/workflows/tracker-voice-v0-disposable-db.yml"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("Tracker Voice Dealer handoff authority", () => {
  it("is a forward-only, fail-closed migration with least privilege preserved", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
    expect(migration).toContain("tracker_voice_dealer_handoff_authority_precondition_failed");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("v_config_exact AND v_config.enabled IS TRUE");
    expect(migration).toContain("v_assignment.user_id IS DISTINCT FROM p_actor");
    expect(migration).toContain("voice_config_disabled");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\._tracker_voice_assignment_context\(UUID, UUID, UUID\)[\s\S]+?FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).not.toMatch(/db push|migration repair|functions deploy|vercel --prod/i);
  });

  it("proves the real PostgreSQL handoff, denial, isolation, and idempotency matrix", () => {
    for (const evidence of [
      "real Swing RPC completes the Voice Dealer handoff",
      "Swing retry creates no assignment and credits no worked minutes twice",
      "Dealer B receives authority, old Dealer A is denied, and the other table is unchanged",
      "pending write from the old Dealer is rechecked server-side and leaves zero events",
      "multiple active assignments fail closed for both actors, including different Dealers",
      "assignment changes and auto-provision do not revive an administratively disabled config",
      "exact reconcile is idempotent and does not change another table",
      "stale Dealer B session requests are denied",
      "Manual session is an immediate server-side Voice kill path",
      "stale config epoch cannot authorize a reopened Tracker mode",
      "closed session denies Voice even if its historical config remains",
      "global Voice gate denies the exact assigned Dealer",
    ]) {
      expect(integration).toContain(evidence);
    }
  });

  it("applies and rollback-tests the migration in isolated PostgreSQL", () => {
    expect(workflow).toContain(migrationName);
    expect(workflow).toContain("20270115000016_dealer_assignment_session_binding.sql");
    expect(workflow).toContain("20260817000003_fix_executor_step9_incoming_credit.sql");
    expect(workflow).toContain("TRACKER_VOICE_15000015_APPLY=PASS");
    expect(workflow).toContain("TRACKER_VOICE_15000015_ROLLBACK=PASS");
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).not.toMatch(/--linked|db push|migration repair|functions deploy|vercel --prod/i);
  });
});
