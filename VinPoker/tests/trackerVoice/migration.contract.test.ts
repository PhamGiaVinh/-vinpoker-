import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationName =
  "20270112000003_tracker_voice_player_analytics_v0.sql";
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
const flags = readFileSync(resolve(root, "src/lib/featureFlags.ts"), "utf8");
const sessionEdge = readFileSync(
  resolve(root, "supabase/functions/tracker-voice-session/index.ts"),
  "utf8",
);

describe("Tracker Voice V0 migration contract", () => {
  it("uses a unique migration version at the repository maximum", () => {
    const names = readdirSync(resolve(root, "supabase/migrations"))
      .filter((name) => /^\d{14}_.+\.sql$/.test(name))
      .sort();
    expect(names.filter((name) => name.startsWith("20270112000003_"))).toEqual([
      migrationName,
    ]);
    expect(names).toContain(migrationName);
  });

  it("keeps every mergeable Voice and Analytics flag disabled", () => {
    expect(flags).toMatch(/trackerVoiceInput:\s*false/);
    expect(flags).toMatch(/trackerPlayerAnalytics:\s*false/);
    expect(flags).toMatch(/trackerVoiceAutoCommit:\s*false/);
  });

  it("stores final transcripts only and keeps the event stream immutable", () => {
    expect(migration).toContain("char_length(final_transcript) BETWEEN 1 AND 500");
    expect(migration).toContain("event_kind IN ('final_transcript', 'canonical_receipt')");
    expect(migration).toContain("TRG_TRACKER_VOICE_EVENTS_IMMUTABLE".toLowerCase());
    expect(migration).not.toMatch(/audio_(blob|bytes|url)|partial_transcript/i);
    expect(migration).toContain("TRACKER_VOICE_EVENT_IMMUTABLE");
  });

  it("keeps privileged registration service-only and browser writes canonical", () => {
    expect(migration).toContain("edge_service_role_required");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\._tracker_voice_register_validated_event\([\s\S]+?FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\._tracker_voice_register_validated_event\([\s\S]+?TO service_role;/,
    );
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.record_action(");
    expect(migration).toContain("voice_event_payload_mismatch");
    expect(migration).toContain("correction_pending");
  });

  it("proves assignment, RLS, idempotency, locking and zero-write rollback", () => {
    for (const evidence of [
      "multiple active assignments fail closed",
      "duplicate Voice callback produces exactly one canonical action",
      "same validated event retry returns original receipt after hand advances",
      "same idempotency key with different event payload is rejected",
      "concurrent Floor transition serializes to one winner and one stale response",
      "cross-club Dealer cannot read another club Voice events",
      "injected failure leaves zero partial event, alert, audit or config writes",
      "TRACKER_VOICE_DISPOSABLE_DB_PASS",
    ]) {
      expect(integration).toContain(evidence);
    }
  });

  it("runs on isolated PostgreSQL without production credentials or remote commands", () => {
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain(migrationName);
    expect(workflow).toContain("TRACKER_VOICE_MIGRATION_ROLLBACK=PASS");
    expect(workflow).not.toMatch(/--linked|db push|migration repair|functions deploy|vercel --prod/i);
    expect(workflow).not.toContain("orlesggcjamwuknxwcpk");
    expect(workflow).not.toMatch(/SUPABASE_(URL|KEY|SERVICE_ROLE_KEY)/i);
  });

  it("never logs provider credentials or permanent OpenAI keys", () => {
    expect(sessionEdge).not.toMatch(/console\.(log|info|warn|error)\([^)]*(secret|api[_-]?key)/i);
    expect(sessionEdge).not.toMatch(/OPENAI_API_KEY\s*[:=]\s*["'][^"']+["']/);
    expect(sessionEdge).toContain("OPENAI_API_KEY");
  });
});
