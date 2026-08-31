import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(resolve(
  root,
  "supabase/pending-migrations/20270114000001_tracker_voice_hole_cards_atomic_confirm_v0.sql",
), "utf8");
const edge = readFileSync(resolve(root, "supabase/functions/tournament-live-update/index.ts"), "utf8");
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

  it("keeps the Hole Cards migration specific while Finish is added separately", () => {
    expect(edge).toContain('case "commit_voice_finish"');
    expect(edge).toContain("buildVoiceFinishCanonicalRequest");
    expect(migration).not.toContain("commit_tracker_voice_finish");
    expect(migration).not.toContain("commit_tracker_voice_muck");
  });
});
