import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const edge = readFileSync(
  resolve(root, "supabase/functions/tournament-live-update/index.ts"),
  "utf8",
);

describe("Tracker Voice Action Assist contract", () => {
  it("keeps PR A action-only and server-recomputes the untrusted wire request", () => {
    expect(edge).toContain("actionWorkflowForStreet(street)");
    expect(edge).toContain("buildVoiceActionCanonicalRequest({");
    expect(edge).toContain("voiceCanonicalRequestsMatch(voice_request, canonicalRequest)");
    expect(edge).toContain('validationError("intent_mismatch"');
    expect(edge).toContain("intent_domain: canonicalRequest.intentDomain");
    expect(edge).not.toContain('intent_domain: "board"');
    expect(edge).not.toContain('intent_domain: "hole_cards"');
    expect(edge).not.toContain('intent_domain: "finish_hand"');
  });
});
