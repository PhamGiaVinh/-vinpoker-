import {
  buildTrackerVoiceGeminiAuthTokenRequest,
  isTrackerVoiceGeminiLiveModel,
  normalizeTrackerVoiceGeminiCredential,
  TRACKER_VOICE_GEMINI_LIVE_MODEL,
} from "./protocol.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Gemini Voice credentials are single-use, time-bounded, and allowlisted", () => {
  const now = Date.UTC(2026, 7, 22, 12, 0, 0);
  assert(
    isTrackerVoiceGeminiLiveModel(TRACKER_VOICE_GEMINI_LIVE_MODEL),
    "allowlisted model expected",
  );
  assert(
    !isTrackerVoiceGeminiLiveModel("gemini-unreviewed"),
    "unreviewed model must be rejected",
  );

  const request = buildTrackerVoiceGeminiAuthTokenRequest(now);
  assert(request.uses === 1, "token must be single-use");
  assert(
    request.newSessionExpireTime === new Date(now + 60_000).toISOString(),
    "session start expiry mismatch",
  );
  assert(
    request.expireTime === new Date(now + 20 * 60_000).toISOString(),
    "session expiry mismatch",
  );
  const constraints = request.bidiGenerateContentSetup as Record<string, unknown>;
  assert(
    constraints.model === `models/${TRACKER_VOICE_GEMINI_LIVE_MODEL}`,
    "REST token constraint must use the Gemini model resource name",
  );
});

Deno.test("Gemini Voice credential normalization fails closed", () => {
  const now = Date.UTC(2026, 7, 22, 12, 0, 0);
  assert(
    normalizeTrackerVoiceGeminiCredential(
      {},
      TRACKER_VOICE_GEMINI_LIVE_MODEL,
      now,
    ) === null,
    "missing token must fail closed",
  );
  const credential = normalizeTrackerVoiceGeminiCredential(
    { name: "token" },
    TRACKER_VOICE_GEMINI_LIVE_MODEL,
    now,
  );
  assert(credential?.ephemeral_token === "token", "token mismatch");
  assert(
    credential.model === TRACKER_VOICE_GEMINI_LIVE_MODEL,
    "model mismatch",
  );
  assert(
    credential.expires_at === new Date(now + 20 * 60_000).toISOString(),
    "expiry mismatch",
  );
});
