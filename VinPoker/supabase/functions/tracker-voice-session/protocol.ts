export const TRACKER_VOICE_DEFAULT_MODEL = "gpt-live-transcribe";

export interface TrackerVoiceSessionCredential {
  client_secret: string;
  model: string;
  expires_at: string;
}

export function buildTrackerVoiceRealtimeSession(model: string): Record<string, unknown> {
  return {
    expires_after: { anchor: "created_at", seconds: 60 },
    session: {
      type: "transcription",
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription: {
            model,
            prompt: "Poker tournament actions and chip amounts in Vietnamese or English.",
            languages: ["vi", "en"],
            keywords: [
              "fold", "check", "call", "bet", "raise", "all-in",
              "bỏ bài", "theo", "tố", "tất tay", "gọi Floor", "báo sai",
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
  const nestedSecret = record.client_secret && typeof record.client_secret === "object"
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
