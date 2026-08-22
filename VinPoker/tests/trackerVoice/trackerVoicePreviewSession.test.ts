import { describe, expect, it, vi } from "vitest";

import {
  createTrackerVoiceUatCredential,
  isTrackerVoiceUatPreview,
  PreviewVoiceRateLimiter,
} from "../../api/tracker-voice-uat-session";

const PREVIEW_ENV = {
  VERCEL_ENV: "preview",
  TRACKER_VOICE_UAT_ENABLED: "true",
  OPENAI_API_KEY: "test-server-key",
};

function openAiCredentialResponse() {
  return new Response(JSON.stringify({
    value: "ek_preview_client_secret",
    expires_at: 2_000_000_000,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("tracker voice Preview session endpoint", () => {
  it("only enables the session path for Vercel Preview with the UAT flag", () => {
    expect(isTrackerVoiceUatPreview(PREVIEW_ENV)).toBe(true);
    expect(isTrackerVoiceUatPreview({ ...PREVIEW_ENV, VERCEL_ENV: "production" })).toBe(false);
    expect(isTrackerVoiceUatPreview({ ...PREVIEW_ENV, TRACKER_VOICE_UAT_ENABLED: "false" })).toBe(false);
  });

  it("rejects production, disabled, wrong-method, and missing-secret requests before OpenAI", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createTrackerVoiceUatCredential(
      { ...PREVIEW_ENV, VERCEL_ENV: "production" },
      { method: "POST", clientIp: "198.51.100.1" },
      { fetcher },
    )).resolves.toMatchObject({ status: 404, body: { error: "preview_uat_disabled" } });
    await expect(createTrackerVoiceUatCredential(
      PREVIEW_ENV,
      { method: "GET", clientIp: "198.51.100.1" },
      { fetcher },
    )).resolves.toMatchObject({ status: 405, body: { error: "method_not_allowed" } });
    await expect(createTrackerVoiceUatCredential(
      { ...PREVIEW_ENV, OPENAI_API_KEY: "" },
      { method: "POST", clientIp: "198.51.100.1" },
      { fetcher },
    )).resolves.toMatchObject({ status: 503, body: { error: "preview_openai_secret_missing" } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("mints a bounded credential without returning the permanent API key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => openAiCredentialResponse());
    const result = await createTrackerVoiceUatCredential(
      PREVIEW_ENV,
      { method: "POST", clientIp: "198.51.100.1" },
      { fetcher, limiter: new PreviewVoiceRateLimiter() },
    );

    expect(result).toEqual({
      status: 200,
      body: {
        client_secret: "ek_preview_client_secret",
        model: "gpt-live-transcribe",
        expires_at: "2033-05-18T03:33:20.000Z",
      },
    });
    expect(JSON.stringify(result)).not.toContain(PREVIEW_ENV.OPENAI_API_KEY);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/client_secrets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${PREVIEW_ENV.OPENAI_API_KEY}`,
          "OpenAI-Safety-Identifier": expect.stringMatching(/^tracker-voice-uat:[a-f0-9]{64}$/),
        }),
      }),
    );
    const request = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      session: {
        type: "transcription",
        audio: {
          input: {
            transcription: {
              model: "gpt-live-transcribe",
              languages: ["vi", "en"],
              delay: "low",
            },
            turn_detection: { type: "server_vad" },
          },
        },
      },
    });
  });

  it("rate limits a protected Preview requester without contacting OpenAI again", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => openAiCredentialResponse());
    const limiter = new PreviewVoiceRateLimiter();
    for (let index = 0; index < 6; index += 1) {
      await expect(createTrackerVoiceUatCredential(
        PREVIEW_ENV,
        { method: "POST", clientIp: "198.51.100.8" },
        { fetcher, limiter, now: () => 1_000 },
      )).resolves.toMatchObject({ status: 200 });
    }
    await expect(createTrackerVoiceUatCredential(
      PREVIEW_ENV,
      { method: "POST", clientIp: "198.51.100.8" },
      { fetcher, limiter, now: () => 1_000 },
    )).resolves.toMatchObject({ status: 429, body: { error: "preview_uat_rate_limited" } });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
});
