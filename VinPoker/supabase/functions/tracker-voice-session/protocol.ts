export const TRACKER_VOICE_DEFAULT_MODEL = "gpt-live-transcribe";
export const TRACKER_VOICE_GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";

export interface TrackerVoiceSessionCredential {
  client_secret: string;
  model: string;
  expires_at: string;
}

export interface TrackerVoiceGeminiSessionCredential {
  ephemeral_token: string;
  model: string;
  expires_at: string;
}

/**
 * Gemini is an explicit server-side allowlist, not a client-selectable model
 * prefix. The config row remains the authority for which session is minted.
 */
export function isTrackerVoiceGeminiLiveModel(model: string): boolean {
  return model === TRACKER_VOICE_GEMINI_LIVE_MODEL;
}

export function buildTrackerVoiceGeminiAuthTokenRequest(
  now: number,
): Record<string, unknown> {
  return {
    uses: 1,
    newSessionExpireTime: new Date(now + 60_000).toISOString(),
    expireTime: new Date(now + 20 * 60_000).toISOString(),
  };
}

export function normalizeTrackerVoiceGeminiCredential(
  payload: unknown,
  model: string,
  now: number,
): TrackerVoiceGeminiSessionCredential | null {
  if (!payload || typeof payload !== "object") return null;
  const token = (payload as Record<string, unknown>).name;
  if (typeof token !== "string" || token.length === 0 || token.length > 4_096) {
    return null;
  }
  return {
    ephemeral_token: token,
    model,
    expires_at: new Date(now + 20 * 60_000).toISOString(),
  };
}

export function buildTrackerVoiceRealtimeSession(
  model: string,
): Record<string, unknown> {
  return {
    expires_after: { anchor: "created_at", seconds: 60 },
    session: {
      type: "transcription",
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription: {
            model,
            prompt:
              "Poker tournament actions and chip amounts in Vietnamese or English.",
            languages: ["vi", "en"],
            keywords: [
              "fold",
              "check",
              "call",
              "bet",
              "raise",
              "all-in",
              "bỏ bài",
              "theo",
              "tố",
              "tất tay",
              "gọi Floor",
              "báo sai",
            ],
            delay: "low",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      },
    },
  };
}

export function normalizeTrackerVoiceCredential(
  payload: unknown,
  model: string,
): TrackerVoiceSessionCredential | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const nestedSecret =
    record.client_secret && typeof record.client_secret === "object"
      ? record.client_secret as Record<string, unknown>
      : null;
  const value = typeof record.value === "string"
    ? record.value
    : typeof nestedSecret?.value === "string"
    ? nestedSecret.value
    : null;
  const rawExpires = record.expires_at ??
    nestedSecret?.expires_at ?? null;
  const expiresAt = typeof rawExpires === "number"
    ? new Date(rawExpires * 1000).toISOString()
    : typeof rawExpires === "string"
    ? rawExpires
    : null;
  if (!value || !expiresAt || Number.isNaN(Date.parse(expiresAt))) return null;
  return { client_secret: value, model, expires_at: expiresAt };
}
