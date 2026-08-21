import { describe, expect, it } from "vitest";

import {
  buildTrackerVoiceRealtimeSession,
  normalizeTrackerVoiceCredential,
} from "../../supabase/functions/tracker-voice-session/protocol";

describe("tracker voice realtime session protocol", () => {
  it("builds a transcription-only, short-lived session without an API key", () => {
    const payload = buildTrackerVoiceRealtimeSession("gpt-live-transcribe");
    expect(payload).toMatchObject({
      expires_after: { anchor: "created_at", seconds: 60 },
      session: {
        type: "transcription",
        audio: { input: { transcription: { model: "gpt-live-transcribe" } } },
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(/api[_-]?key|secret/i);
  });

  it("normalizes both supported client-secret response shapes", () => {
    expect(normalizeTrackerVoiceCredential(
      { value: "ek_test", expires_at: 2_000_000_000 },
      "gpt-live-transcribe",
    )).toEqual({
      client_secret: "ek_test",
      model: "gpt-live-transcribe",
      expires_at: new Date(2_000_000_000 * 1000).toISOString(),
    });
    expect(normalizeTrackerVoiceCredential(
      { client_secret: { value: "ek_nested", expires_at: "2033-05-18T03:33:20.000Z" } },
      "gpt-live-transcribe",
    )?.client_secret).toBe("ek_nested");
  });

  it("fails closed for malformed provider responses", () => {
    expect(normalizeTrackerVoiceCredential({}, "gpt-live-transcribe")).toBeNull();
    expect(normalizeTrackerVoiceCredential({ value: "ek_test" }, "gpt-live-transcribe")).toBeNull();
  });
});
