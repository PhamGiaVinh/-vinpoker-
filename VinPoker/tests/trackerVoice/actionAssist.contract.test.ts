import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const edge = readFileSync(
  resolve(root, "supabase/functions/tournament-live-update/index.ts"),
  "utf8",
);

describe("Tracker Voice Action and Board Assist contract", () => {
  it("keeps the enabled domains bounded and server-recomputes every untrusted wire request", () => {
    expect(edge).toContain("actionWorkflowForStreet(street)");
    expect(edge).toContain("buildVoiceActionCanonicalRequest({");
    expect(edge).toContain("voiceCanonicalRequestsMatch(voice_request, canonicalRequest)");
    expect(edge).toContain('validationError("intent_mismatch"');
    expect(edge).toContain("intent_domain: canonicalRequest.intentDomain");
    expect(edge).toContain('intent_domain: "board"');
    expect(edge).toContain("routeTrackerVoiceIntent(final_transcript");
    expect(edge).toContain("commit_tracker_voice_board_v0");
    expect(edge).not.toContain('intent_domain: "hole_cards"');
    expect(edge).not.toContain('intent_domain: "finish_hand"');
  });
});
