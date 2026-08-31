import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(resolve(
  root,
  "supabase/pending-migrations/20270114000002_tracker_voice_finish_atomic_commit_v0.sql",
), "utf8");
const edge = readFileSync(resolve(root, "supabase/functions/tournament-live-update/index.ts"), "utf8");
const panel = readFileSync(resolve(root, "src/components/tracker/voice/TrackerVoicePanel.tsx"), "utf8");

describe("Tracker Voice Finish Assist contract", () => {
  it("uses the existing record_hand writer and appends the receipt atomically", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.record_hand(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.commit_tracker_voice_finish_v0(");
    expect(migration).toContain("v_core_result := public.record_hand(");
    expect(migration).toContain("canonical_receipt");
    expect(migration).toContain("finish_proposal_stale");
    expect(migration).toContain("voice_dealer_assignment_required");
    expect(migration).toContain("edge_service_role_required");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.commit_tracker_voice_finish_v0");
    expect(migration).toContain("TO service_role");
  });

  it("keeps browser fields diagnostic and rebuilds Finish from persisted state", () => {
    expect(edge).toContain('case "prepare_voice_finish"');
    expect(edge).toContain('case "commit_voice_finish"');
    expect(edge).toContain("loadAuthoritativeVoiceFinish");
    expect(edge).toContain("computeVoiceFinishSettlement");
    expect(edge).toContain("buildVoiceFinishCanonicalRequest");
    expect(edge).toContain('validationError("finish_proposal_stale"');
    expect(edge).not.toMatch(/case "commit_voice_finish"[\s\S]*?from\("tournament_hands"\)\.update\(/);
  });

  it("derives submit_ready from the server snapshot before either Finish boundary", () => {
    expect(edge).toMatch(
      /case "prepare_voice_finish":[\s\S]*?const expectedWorkflowState = workflowForVoiceSnapshot\(snapshot\);[\s\S]*?expectedWorkflowState !== "submit_ready"/,
    );
    expect(edge).toMatch(
      /case "commit_voice_finish":[\s\S]*?const expectedWorkflowState = workflowForVoiceSnapshot\(snapshot\);[\s\S]*?expectedWorkflowState !== "submit_ready"/,
    );
  });

  it("requires explicit touch confirmation and never presents an Auto Finish", () => {
    expect(panel).toContain("VOICE FINISH ASSIST");
    expect(panel).toContain("CHƯA LƯU HAND");
    expect(panel).toContain("CẦN CHẠM XÁC NHẬN");
    expect(panel).toContain("XÁC NHẬN LƯU HAND");
    expect(panel).toContain("HỦY");
    expect(panel).toContain("confirmFinishAssist");
    expect(panel).not.toContain("Auto Finish");
  });
});
