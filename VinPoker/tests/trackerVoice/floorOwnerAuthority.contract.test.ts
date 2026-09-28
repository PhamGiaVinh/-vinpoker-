import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationName = "20270115000020_tracker_voice_floor_owner_authority.sql";
const telegramDealerMigrationName = "20270128000008_tracker_voice_floor_owner_telegram_dealer.sql";
const migration = readFileSync(
  resolve(root, "supabase/migrations", migrationName),
  "utf8",
).replace(/\r\n/g, "\n");
const telegramDealerMigration = readFileSync(
  resolve(root, "supabase/migrations", telegramDealerMigrationName),
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

  it("separates operational Dealer identity from the authenticated actor", () => {
    expect(telegramDealerMigration).toContain("v_operational_assignment_count");
    expect(telegramDealerMigration).toContain("public.is_club_admin(p_actor, v_tour.club_id)");
    expect(telegramDealerMigration).not.toMatch(
      /WHERE dealer_row\.club_id = v_tour\.club_id\s+AND dealer_row\.status = 'active'\s+AND dealer_row\.user_id IS NOT NULL/,
    );
    expect(telegramDealerMigration).toContain("v_assignment.user_id IS DISTINCT FROM p_actor");
    expect(telegramDealerMigration).toContain("v_actor_is_owner_or_floor IS NOT TRUE");
    expect(telegramDealerMigration).toContain("SET search_path = ''");
    expect(telegramDealerMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\._tracker_voice_assignment_context\(UUID, UUID, UUID\)[\s\S]+?FROM PUBLIC, anon, authenticated, service_role;/,
    );
  });

  it("covers allowed and denied actors through the public runtime seam", () => {
    for (const evidence of [
      "exact-club Owner can use Voice while the sole current Dealer remains assigned",
      "exact-club Floor can use Voice while the sole current Dealer remains assigned",
      "Owner or Floor from another club cannot use Voice",
      "Tracker-only member cannot gain Owner or Floor Voice authority",
      "Telegram-only assigned Dealer permits exact-club Owner and Floor but cannot authenticate or impersonate",
    ]) {
      expect(integration).toContain(evidence);
    }
  });

  it("applies and rollback-tests the exact migration in isolated PostgreSQL", () => {
    expect(workflow).toContain(migrationName);
    expect(workflow).toContain(telegramDealerMigrationName);
    expect(workflow).toContain("TRACKER_VOICE_15000020_APPLY=PASS");
    expect(workflow).toContain("TRACKER_VOICE_15000020_ROLLBACK=PASS");
    expect(workflow).toContain("TRACKER_VOICE_28000008_APPLY=PASS");
    expect(workflow).toContain("TRACKER_VOICE_28000008_ROLLBACK=PASS");
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).not.toMatch(/--linked|db push|migration repair|functions deploy|vercel --prod/i);
  });
});
