import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(resolve(
  root,
  "supabase/pending-migrations/20270113000009_tracker_voice_board_atomic_commit_v0.sql",
), "utf8");
const edge = readFileSync(resolve(root, "supabase/functions/tournament-live-update/index.ts"), "utf8");
const panel = readFileSync(resolve(root, "src/components/tracker/voice/TrackerVoicePanel.tsx"), "utf8");

describe("Tracker Voice Board Assist contract", () => {
  it("uses the existing manual Board writer inside the atomic Voice receipt", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.update_community_cards(");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.commit_tracker_voice_board_v0(");
    expect(migration).toContain("v_result := public.update_community_cards(v_root.hand_id, v_cards, v_actor);");
    expect(migration).toContain("current_user <> pg_get_userbyid");
    expect(migration).toContain("canonical_receipt");
    expect(migration).toContain("board_already_persisted");
    expect(migration).toContain("card_already_used_by_hole_cards");
    expect(migration).toContain("edge_service_role_required");
    expect(migration).toContain("p_execution_mode NOT IN ('shadow', 'assist')");
  });

  it("does not create dormant Hole Card or Finish writer domains", () => {
    expect(migration).not.toContain("commit_tracker_voice_hole");
    expect(migration).not.toContain("commit_tracker_voice_finish");
    expect(edge).not.toContain('intent_domain: "hole_cards"');
    expect(edge).not.toContain('intent_domain: "finish_hand"');
  });

  it("keeps Voice Board proposal-only until a touch confirmation", () => {
    expect(panel).toContain("CẦN CHẠM XÁC NHẬN · CHƯA GHI BOARD");
    expect(panel).toContain("confirmBoardAssist");
    expect(panel).toContain("applyVoiceBoardReceipt");
    expect(panel).toContain("Đề xuất Board đã hết hiệu lực");
  });

  it("routes server-side and calls exactly one canonical Board RPC", () => {
    expect(edge).toContain("routeTrackerVoiceIntent(final_transcript");
    expect(edge).toContain("_tracker_voice_register_validated_board_event");
    expect(edge).toContain('case "commit_voice_board"');
    expect(edge).not.toMatch(/from\("tournament_hands"\)\.update\(/);
  });
});
