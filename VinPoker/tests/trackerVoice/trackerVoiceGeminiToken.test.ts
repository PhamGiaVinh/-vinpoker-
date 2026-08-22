import { describe, expect, it, vi } from "vitest";

import {
  createTrackerVoiceGeminiCredential,
  GeminiPreviewRateLimiter,
  isTrackerVoiceGeminiPreview,
} from "../../api/tracker-voice-gemini-token";

const PREVIEW_ENV = {
  VERCEL_ENV: "preview",
  TRACKER_VOICE_UAT_ENABLED: "true",
  GEMINI_API_KEY: "test-server-key",
};

function tokenResponse() {
  return new Response(JSON.stringify({
    name: "ephemeral-preview-token",
    expireTime: "2033-05-18T03:33:20.000Z",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("tracker voice Gemini Preview token endpoint", () => {
  it("only enables Gemini Live credential minting for Preview with the UAT flag", () => {
    expect(isTrackerVoiceGeminiPreview(PREVIEW_ENV)).toBe(true);
    expect(isTrackerVoiceGeminiPreview({ ...PREVIEW_ENV, VERCEL_ENV: "production" })).toBe(false);
    expect(isTrackerVoiceGeminiPreview({ ...PREVIEW_ENV, TRACKER_VOICE_UAT_ENABLED: "false" })).toBe(false);
  });

  it("fails closed before Gemini for production, disabled, wrong-method, and missing-secret requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createTrackerVoiceGeminiCredential(
      { ...PREVIEW_ENV, VERCEL_ENV: "production" },
      { method: "POST", clientIp: "198.51.100.1" },
      { fetcher },
    )).resolves.toMatchObject({ status: 404, body: { error: "preview_uat_disabled" } });
    await expect(createTrackerVoiceGeminiCredential(
      PREVIEW_ENV,
      { method: "GET", clientIp: "198.51.100.1" },
      { fetcher },
    )).resolves.toMatchObject({ status: 405, body: { error: "method_not_allowed" } });
    await expect(createTrackerVoiceGeminiCredential(
      { ...PREVIEW_ENV, GEMINI_API_KEY: "" },
      { method: "POST", clientIp: "198.51.100.1" },
      { fetcher },
    )).resolves.toMatchObject({ status: 503, body: { error: "gemini_preview_secret_missing" } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("mints a constrained ephemeral token without returning the permanent API key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => tokenResponse());
    const result = await createTrackerVoiceGeminiCredential(
      PREVIEW_ENV,
      { method: "POST", clientIp: "198.51.100.1" },
      { fetcher, limiter: new GeminiPreviewRateLimiter(), now: () => 1_000 },
    );

    expect(result).toEqual({
      status: 200,
      body: {
        ephemeral_token: "ephemeral-preview-token",
        expires_at: "2033-05-18T03:33:20.000Z",
        model: "gemini-3.1-flash-live-preview",
      },
    });
    expect(JSON.stringify(result)).not.toContain(PREVIEW_ENV.GEMINI_API_KEY);
    expect(fetcher).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1alpha/auth_tokens",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-goog-api-key": PREVIEW_ENV.GEMINI_API_KEY,
        }),
      }),
    );
    const request = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      uses: 1,
      newSessionExpireTime: "1970-01-01T00:01:01.000Z",
      expireTime: "1970-01-01T00:20:01.000Z",
      liveConnectConstraints: {
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: ["AUDIO"],
          inputAudioTranscription: {},
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              prefixPaddingMs: 300,
              silenceDurationMs: 600,
            },
          },
        },
      },
    });
  });

  it("classifies an upstream token rejection without exposing its response body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("provider details", { status: 403 }));
    await expect(createTrackerVoiceGeminiCredential(
      PREVIEW_ENV,
      { method: "POST", clientIp: "198.51.100.11" },
      { fetcher, limiter: new GeminiPreviewRateLimiter(), now: () => 1_000 },
    )).resolves.toEqual({ status: 502, body: { error: "gemini_ephemeral_token_unauthorized" } });
  });

  it("rate limits a Preview requester without contacting Gemini again", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => tokenResponse());
    const limiter = new GeminiPreviewRateLimiter();
    for (let index = 0; index < 6; index += 1) {
      await expect(createTrackerVoiceGeminiCredential(
        PREVIEW_ENV,
        { method: "POST", clientIp: "198.51.100.8" },
        { fetcher, limiter, now: () => 1_000 },
      )).resolves.toMatchObject({ status: 200 });
    }
    await expect(createTrackerVoiceGeminiCredential(
      PREVIEW_ENV,
      { method: "POST", clientIp: "198.51.100.8" },
      { fetcher, limiter, now: () => 1_000 },
    )).resolves.toMatchObject({ status: 429, body: { error: "preview_uat_rate_limited" } });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
});
