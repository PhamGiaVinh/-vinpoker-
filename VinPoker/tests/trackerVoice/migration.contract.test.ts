import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { isTrackerVoiceBuildEnabled } from "@/lib/featureFlags";
import { isTrackerVoiceUiEnabled } from "@/lib/trackerVoice/uiGate";
import type { TrackerVoiceRuntimeContext } from "@/lib/trackerVoice";

const root = process.cwd();
const migrationName =
  "20270112000003_tracker_voice_player_analytics_v0.sql";
const geminiMigrationName =
  "20270112000008_tracker_voice_gemini_live_provider.sql";
const transcribeBindingMigrationName =
  "20270113000007_tracker_voice_transcribe35_binding.sql";
const migration = readFileSync(
  resolve(root, "supabase/migrations", migrationName),
  "utf8",
).replace(/\r\n/g, "\n");
const geminiMigration = readFileSync(
  resolve(root, "supabase/migrations", geminiMigrationName),
  "utf8",
).replace(/\r\n/g, "\n");
const transcribeBindingMigration = readFileSync(
  resolve(root, "supabase/pending-migrations", transcribeBindingMigrationName),
  "utf8",
).replace(/\r\n/g, "\n");
const unifiedOpsMigration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20270108000003_tracker_unified_ops_v2_context_safe_start.sql",
  ),
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
const recordActionAuthorityWorkflow = readFileSync(
  resolve(root, "../.github/workflows/tracker-record-action-authority-hotfix-db.yml"),
  "utf8",
).replace(/\r\n/g, "\n");
const flags = readFileSync(resolve(root, "src/lib/featureFlags.ts"), "utf8");
const sessionEdge = readFileSync(
  resolve(root, "supabase/functions/tracker-voice-session/index.ts"),
  "utf8",
);
const voiceGate = readFileSync(
  resolve(root, "src/components/tracker/voice/TrackerVoicePanelGate.tsx"),
  "utf8",
);
const handInputConsole = readFileSync(
  resolve(root, "src/components/cashier/tournament-live/handinput/RacetrackHandInputConsole.tsx"),
  "utf8",
);

function runtimeFixture(
  overrides: Partial<TrackerVoiceRuntimeContext> = {},
): TrackerVoiceRuntimeContext {
  return {
    ok: true,
    can_mint_session: true,
    read_only: false,
    correction_pending: false,
    config: {
      enabled: true,
      configured_mode: "shadow",
      provider_model: "gemini-3.1-flash-live-preview",
      spoken_amount_unit: 1,
      amount_unit_confirmed: false,
      provider_confidence_threshold: null,
      server_auto_allowed: false,
      correction_state: "ready",
    },
    active_hand: null,
    ...overrides,
  };
}

describe("Tracker Voice V0 migration contract", () => {
  it("uses a unique migration version at the repository maximum", () => {
    const names = readdirSync(resolve(root, "supabase/migrations"))
      .filter((name) => /^\d{14}_.+\.sql$/.test(name))
      .sort();
    expect(names.filter((name) => name.startsWith("20270112000003_"))).toEqual([
      migrationName,
    ]);
    expect(names.filter((name) => name.startsWith("20270112000008_"))).toEqual([
      geminiMigrationName,
    ]);
    expect(names.filter((name) => name.startsWith("20270113000007_"))).toEqual([
      transcribeBindingMigrationName,
    ]);
    expect(names).toContain(migrationName);
    expect(names).toContain(geminiMigrationName);
    expect(names).toContain(transcribeBindingMigrationName);
  });

  it("enables the Voice build gate only for the exact approved Vite value", () => {
    expect(isTrackerVoiceBuildEnabled(undefined)).toBe(false);
    expect(isTrackerVoiceBuildEnabled("")).toBe(false);
    expect(isTrackerVoiceBuildEnabled("false")).toBe(false);
    expect(isTrackerVoiceBuildEnabled("1")).toBe(false);
    expect(isTrackerVoiceBuildEnabled("yes")).toBe(false);
    expect(isTrackerVoiceBuildEnabled("TRUE")).toBe(false);
    expect(isTrackerVoiceBuildEnabled(true)).toBe(false);
    expect(isTrackerVoiceBuildEnabled("true")).toBe(true);
    expect(flags).toContain("trackerVoiceInput: isTrackerVoiceBuildEnabled(import.meta.env.VITE_TRACKER_VOICE_INPUT)");
    expect(flags).toMatch(/trackerPlayerAnalytics:\s*false/);
    expect(flags).toMatch(/trackerVoiceAutoCommit:\s*false/);
  });

  it("requires the server-authoritative runtime gate after the build gate", () => {
    expect(handInputConsole).toContain("FEATURES.trackerVoiceInput ? <TrackerVoicePanelGate hook={hook} /> : null");
    expect(voiceGate).toContain("loadTrackerVoiceRuntimeContext");
    expect(voiceGate).toContain("isTrackerVoiceUiEnabled(runtime)");
    expect(isTrackerVoiceUiEnabled(runtimeFixture())).toBe(true);
    expect(isTrackerVoiceUiEnabled(runtimeFixture({ ok: false }))).toBe(false);
    expect(isTrackerVoiceUiEnabled(runtimeFixture({ read_only: true }))).toBe(false);
    expect(isTrackerVoiceUiEnabled(runtimeFixture({
      config: { ...runtimeFixture().config, enabled: false },
    }))).toBe(false);
    expect(isTrackerVoiceUiEnabled(null)).toBe(false);
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
    expect(workflow).toContain("20270108000003_tracker_unified_ops_v2_context_safe_start.sql");
    expect(workflow).toContain(geminiMigrationName);
    expect(workflow).toContain(transcribeBindingMigrationName);
    expect(recordActionAuthorityWorkflow).toContain(transcribeBindingMigrationName);
    expect(workflow).toContain("TRACKER_VOICE_P0_CATALOG_UNCHANGED=PASS");
    expect(workflow).toContain("TRACKER_VOICE_EXACT_CHAIN_ROLLBACK=PASS");
    expect(workflow).not.toMatch(/--linked|db push|migration repair|functions deploy|vercel --prod/i);
    expect(workflow).not.toContain("orlesggcjamwuknxwcpk");
    expect(workflow).not.toMatch(/SUPABASE_(URL|KEY|SERVICE_ROLE_KEY)/i);
  });

  it("never logs provider credentials or permanent OpenAI keys", () => {
    expect(sessionEdge).not.toMatch(/console\.(log|info|warn|error)\([^)]*(secret|api[_-]?key)/i);
    expect(sessionEdge).not.toMatch(/OPENAI_API_KEY\s*[:=]\s*["'][^"']+["']/);
    expect(sessionEdge).toContain("OPENAI_API_KEY");
  });

  it("adds Gemini only through the service-owned validated-event seam", () => {
    expect(geminiMigration).toContain("tracker_voice_v0_dependency_missing");
    expect(geminiMigration).toContain(
      "CHECK (provider_name IN ('openai_realtime', 'gemini_live', 'mock'))",
    );
    expect(geminiMigration).toContain("p_provider_name NOT IN ('openai_realtime', 'gemini_live', 'mock')");
    expect(geminiMigration).toContain("voice_provider_config_mismatch");
    expect(geminiMigration).toContain("p_provider_name = 'gemini_live'");
    expect(geminiMigration).toContain("v_config.provider_model <> 'gemini-3.1-flash-live-preview'");
    expect(geminiMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\._tracker_voice_register_validated_event\([\s\S]+?FROM PUBLIC, anon, authenticated;/,
    );
    expect(geminiMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\._tracker_voice_register_validated_event\([\s\S]+?TO service_role;/,
    );
  });

  it("binds Gemini Transcribe requests to the configured provider and exact reviewed model", () => {
    expect(transcribeBindingMigration).toContain("gemini-3.1-flash-live-preview");
    expect(transcribeBindingMigration).toContain("gemini-3.5-transcribe-live");
    expect(transcribeBindingMigration).toContain("p_provider_name <> 'gemini_live'");
    expect(transcribeBindingMigration).toContain("p_provider_model <> v_config.provider_model");
    expect(transcribeBindingMigration).toContain("tracker_voice_provider_binding_precondition_failed");
    expect(transcribeBindingMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\._tracker_voice_register_validated_event\([\s\S]+?FROM PUBLIC, anon, authenticated;/,
    );
    expect(transcribeBindingMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\._tracker_voice_register_validated_event\([\s\S]+?TO service_role;/,
    );
  });

  it("keeps the Unified Ops dependency explicit and lets Gemini Auto fail closed without provider confidence", () => {
    expect(migration).toContain("public._tracker_unified_ops_request_hash_v2");
    expect(migration).toContain("public.tracker_unified_ops_lock_tournament");
    expect(unifiedOpsMigration).toContain(
      "CREATE OR REPLACE FUNCTION public._tracker_unified_ops_request_hash_v2",
    );
    expect(unifiedOpsMigration).toContain(
      "CREATE OR REPLACE FUNCTION public.tracker_unified_ops_lock_tournament",
    );
    for (const guard of [
      "p_provider_confidence IS NULL",
      "v_config.provider_confidence_threshold IS NULL",
      "p_provider_confidence < v_config.provider_confidence_threshold",
      "'error', 'auto_capability_missing'",
    ]) {
      expect(geminiMigration).toContain(guard);
    }
    expect(integration).toContain("\\if :gemini_provider_available");
    expect(integration).toContain("Gemini Shadow is allowed while confidence-less Auto remains impossible");
  });

  it("mints a Gemini credential only after the existing assignment and rate-limit gates", () => {
    const runtimeGate = sessionEdge.indexOf("get_tracker_voice_runtime_context");
    const rateLimitGate = sessionEdge.indexOf("_tracker_voice_consume_session_rate_limit");
    const geminiBranch = sessionEdge.indexOf("isTrackerVoiceGeminiLiveModel(model)");
    expect(runtimeGate).toBeGreaterThanOrEqual(0);
    expect(rateLimitGate).toBeGreaterThan(runtimeGate);
    expect(geminiBranch).toBeGreaterThan(rateLimitGate);
    expect(sessionEdge).toContain('provider: "gemini_live"');
    expect(sessionEdge).toContain("GEMINI_API_KEY");
    expect(sessionEdge).not.toMatch(/GEMINI_API_KEY\s*[:=]\s*["'][^"']+["']/);
  });
});
