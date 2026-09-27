import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationName = "20270115000019_tracker_voice_floor_owner_authority.sql";
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

describe("Tracker Voice Owner and Floor authority", () => {
  it("keeps exact-session Dealer integrity and grants only exact-club Owner or Floor", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
    expect(migration).toContain("tracker_voice_floor_owner_authority_precondition_failed");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("club_row.owner_id = p_actor");
    expect(migration).toContain("public.is_club_floor(p_actor, v_tour.club_id)");
    expect(migration).toContain("v_assignment.user_id IS DISTINCT FROM p_actor");
    expect(migration).toContain("v_actor_is_owner_or_floor IS NOT TRUE");
    expect(migration).toContain("v_assignment_count <> 1");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\._tracker_voice_assignment_context\(UUID, UUID, UUID\)[\s\S]+?FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).not.toMatch(/db push|migration repair|functions deploy|vercel --prod/i);
  });

  it("covers allowed and denied actors through the public runtime seam", () => {
    for (const evidence of [
      "exact-club Owner can use Voice while the sole current Dealer remains assigned",
      "exact-club Floor can use Voice while the sole current Dealer remains assigned",
      "Owner or Floor from another club cannot use Voice",
      "Tracker-only member cannot gain Owner or Floor Voice authority",
    ]) {
      expect(integration).toContain(evidence);
    }
  });

  it("applies and rollback-tests the exact migration in isolated PostgreSQL", () => {
    expect(workflow).toContain(migrationName);
    expect(workflow).toContain("TRACKER_VOICE_15000019_APPLY=PASS");
    expect(workflow).toContain("TRACKER_VOICE_15000019_ROLLBACK=PASS");
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).not.toMatch(/--linked|db push|migration repair|functions deploy|vercel --prod/i);
  });
});
