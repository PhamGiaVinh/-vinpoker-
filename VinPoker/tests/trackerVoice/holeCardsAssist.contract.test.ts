import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(resolve(
  root,
  "supabase/migrations/20270114000001_tracker_voice_hole_cards_atomic_confirm_v0.sql",
), "utf8");
const coveringStackMigration = readFileSync(resolve(
  root,
  "supabase/migrations/20270114000010_tracker_voice_covering_stack_hole_cards.sql",
), "utf8");
const edge = readFileSync(resolve(root, "supabase/functions/tournament-live-update/index.ts"), "utf8");
const api = readFileSync(resolve(root, "src/lib/trackerVoice/api.ts"), "utf8");
const panel = readFileSync(resolve(root, "src/components/tracker/voice/TrackerVoicePanel.tsx"), "utf8");

describe("Tracker Voice Hole Cards Assist contract", () => {
  it("uses the canonical manual writer inside the service-only Voice receipt", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.show_hole_cards(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.commit_tracker_voice_hole_cards_v0(");
    expect(migration).toContain("v_core_result := public.show_hole_cards(");
    expect(migration).toContain("v_service_voice_call BOOLEAN");
    expect(migration).toContain("hole_cards_already_persisted");
    expect(migration).toContain("voice_hole_card_correction_required");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.commit_tracker_voice_hole_cards_v0");
    expect(migration).toContain("TO service_role");
    expect(migration).toMatch(
      /FUNCTION public\.show_hole_cards\([\s\S]*?LANGUAGE plpgsql\s+SECURITY INVOKER\s+SET search_path = public/,
    );
    expect(migration).not.toContain("_tracker_apply_hole_cards_core_v0");
  });

  it("makes root, card mutation, and receipt one transaction with a redacted audit row", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
    expect(migration).toContain("Seat %s [HOLE_CARDS_REDACTED]");
    expect(migration).toContain("'redacted', true");
    expect(migration).toContain("canonical_receipt");
    expect(migration).not.toContain("p_final_transcript");
  });

  it("keeps raw private speech out of generic validation and diagnostics", () => {
    expect(edge).toContain('case "commit_voice_hole_cards"');
    expect(edge).toContain("VOICE_HOLE_CARDS_CONFIRM_ONLY");
    expect(panel).toContain("PrivateHoleCardsAttempt");
    expect(panel).toContain("looksLikePrivateHoleCardsTranscript");
    expect(panel).not.toContain("privateHoleCardsAttempt:");
    expect(panel).toContain("CẦN CHẠM XÁC NHẬN · CHƯA GHI BÀI");
  });

  it("allows one matched covering stack without allowing an early reveal", () => {
    expect(coveringStackMigration).toContain("_tracker_voice_runout_reveal_authoritative_v1");
    expect(coveringStackMigration).toContain("state.all_in_count >= 1");
    expect(coveringStackMigration).toContain("state.covering_count <= 1");
    expect(coveringStackMigration).toContain("player.committed < aggregate_state.highest_commitment");
    expect(coveringStackMigration).toContain("runout_reveal_not_authoritative");
    expect(coveringStackMigration).toContain("v_definition := replace(v_definition, E'\\r\\n', E'\\n')");
    expect(coveringStackMigration).toContain("v_old_authority := replace(v_old_authority, E'\\r\\n', E'\\n')");
    expect(coveringStackMigration).toContain("v_new_authority := replace(v_new_authority, E'\\r\\n', E'\\n')");
    expect(coveringStackMigration).not.toMatch(/DROP\s+(TABLE|FUNCTION)|TRUNCATE|DELETE\s+FROM/i);
  });

  it("surfaces canonical Hole Cards denials instead of a successful Edge envelope", () => {
    expect(edge).toMatch(
      /action === "commit_voice_hole_cards"[\s\S]*?status: 409/,
    );
    expect(api).toContain("await throwEdgeFunctionError");
    expect(api).toContain('receipt?.ok === false && typeof receipt.error === "string"');
  });

  it("keeps the Hole Cards migration specific while Finish is added separately", () => {
    expect(edge).toContain('case "commit_voice_finish"');
    expect(edge).toContain("buildVoiceFinishCanonicalRequest");
    expect(migration).not.toContain("commit_tracker_voice_finish");
    expect(migration).not.toContain("commit_tracker_voice_muck");
  });
});
