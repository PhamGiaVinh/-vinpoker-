import { describe, expect, it, vi } from "vitest";

import {
  buildGeminiAuthTokenRequest,
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
    const tokenCreator = vi.fn();
    await expect(createTrackerVoiceGeminiCredential(
      { ...PREVIEW_ENV, VERCEL_ENV: "production" },
      { method: "POST", clientIp: "198.51.100.1" },
      { tokenCreator },
    )).resolves.toMatchObject({ status: 404, body: { error: "preview_uat_disabled" } });
    await expect(createTrackerVoiceGeminiCredential(
      PREVIEW_ENV,
      { method: "GET", clientIp: "198.51.100.1" },
      { tokenCreator },
    )).resolves.toMatchObject({ status: 405, body: { error: "method_not_allowed" } });
    await expect(createTrackerVoiceGeminiCredential(
      { ...PREVIEW_ENV, GEMINI_API_KEY: "" },
      { method: "POST", clientIp: "198.51.100.1" },
      { tokenCreator },
    )).resolves.toMatchObject({ status: 503, body: { error: "gemini_preview_secret_missing" } });
    expect(tokenCreator).not.toHaveBeenCalled();
  });

  it("mints a constrained ephemeral token without returning the permanent API key", async () => {
    const tokenCreator = vi.fn().mockImplementation(async () => tokenResponse().json());
    const result = await createTrackerVoiceGeminiCredential(
      PREVIEW_ENV,
      { method: "POST", clientIp: "198.51.100.1" },
      { tokenCreator, limiter: new GeminiPreviewRateLimiter(), now: () => 1_000 },
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
    expect(tokenCreator).toHaveBeenCalledWith(PREVIEW_ENV, 1_000);
    expect(buildGeminiAuthTokenRequest(1_000)).toEqual({
      uses: 1,
      newSessionExpireTime: "1970-01-01T00:01:01.000Z",
      expireTime: "1970-01-01T00:20:01.000Z",
      liveConnectConstraints: {
        model: "models/gemini-3.1-flash-live-preview",
        config: {
          sessionResumption: {},
          responseModalities: ["AUDIO"],
        },
      },
    });
  });

  it("classifies an upstream token rejection without exposing its response body", async () => {
    const tokenCreator = vi.fn().mockRejectedValue({ status: 403, message: "provider details" });
    await expect(createTrackerVoiceGeminiCredential(
      PREVIEW_ENV,
      { method: "POST", clientIp: "198.51.100.11" },
      { tokenCreator, limiter: new GeminiPreviewRateLimiter(), now: () => 1_000 },
    )).resolves.toEqual({ status: 502, body: { error: "gemini_ephemeral_token_unauthorized" } });
  });

  it("rate limits a Preview requester without contacting Gemini again", async () => {
    const tokenCreator = vi.fn().mockImplementation(async () => tokenResponse().json());
    const limiter = new GeminiPreviewRateLimiter();
    for (let index = 0; index < 6; index += 1) {
      await expect(createTrackerVoiceGeminiCredential(
        PREVIEW_ENV,
        { method: "POST", clientIp: "198.51.100.8" },
        { tokenCreator, limiter, now: () => 1_000 },
      )).resolves.toMatchObject({ status: 200 });
    }
    await expect(createTrackerVoiceGeminiCredential(
      PREVIEW_ENV,
      { method: "POST", clientIp: "198.51.100.8" },
      { tokenCreator, limiter, now: () => 1_000 },
    )).resolves.toMatchObject({ status: 429, body: { error: "preview_uat_rate_limited" } });
    expect(tokenCreator).toHaveBeenCalledTimes(6);
  });
});
