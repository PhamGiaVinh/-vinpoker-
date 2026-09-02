export const TRACKER_VOICE_GEMINI_LEGACY_MODEL = "gemini-3.1-flash-live-preview";
export const TRACKER_VOICE_GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe-live";

export type GeminiTranscribeLanguageProfile = "auto" | "vi_en";

export interface GeminiLiveConnectionProfile {
  model: string;
  config: Record<string, unknown>;
}

// ASR biasing remains canonical. Error spellings are handled only by the strict hardener.
export const TRACKER_VOICE_GEMINI_TRANSCRIBE_VOCABULARY = [
  "fold", "bỏ bài", "check", "kiểm", "check bài", "call", "theo", "theo bài",
  "all in", "all-in", "tất tay", "bet", "cược", "raise", "raise to", "tố lên",
  "seat one", "seat two", "seat three", "seat four", "seat five", "seat six", "seat seven", "seat eight", "seat nine", "seat ten",
  "ghế số một", "ghế số hai", "ghế số ba", "ghế số bốn", "ghế số năm", "ghế số sáu", "ghế số bảy", "ghế số tám", "ghế số chín", "ghế số mười",
  "nghìn", "ngàn", "triệu", "thousand", "million",
  "raise 50k", "raise 80k", "raise 100k", "raise 120k", "raise 150k", "raise 200k", "raise 250k", "raise 500k",
  "raise một trăm nghìn", "raise một trăm hai mươi nghìn", "raise hai trăm nghìn", "raise năm trăm nghìn",
  "raise one hundred thousand", "raise one hundred twenty thousand",
  "bet 50k", "bet 80k", "bet 100k", "bet 120k", "bet 200k", "bet 500k",
  "cược năm mươi nghìn", "cược tám mươi nghìn", "cược một trăm nghìn", "cược hai trăm nghìn",
  "báo sai action", "gọi floor", "button", "small blind", "big blind",
] as const;

export function parseGeminiTranscribeLanguageProfile(value: unknown): GeminiTranscribeLanguageProfile | null {
  return value === "auto" || value === "vi_en" ? value : null;
}

function automaticVadConfig() {
  return {
    automaticActivityDetection: {
      disabled: false,
      prefixPaddingMs: 300,
      silenceDurationMs: 600,
    },
  };
}

/** The only reviewed profile builder used by Preview and the authenticated Edge session. */
export function buildGeminiTranscribeProfile(mode: GeminiTranscribeLanguageProfile): GeminiLiveConnectionProfile {
  return {
    model: TRACKER_VOICE_GEMINI_TRANSCRIBE_MODEL,
    config: {
      responseModalities: ["TEXT"],
      inputAudioTranscription: {
        languageCodes: mode === "auto" ? [] : ["vi-VN", "en-US"],
        customVocabulary: [...TRACKER_VOICE_GEMINI_TRANSCRIBE_VOCABULARY],
        mode: "VERBATIM",
      },
      realtimeInputConfig: automaticVadConfig(),
    },
  };
}

/** Legacy is retained only for existing configured rows and shares the single VAD/vocabulary policy. */
export function buildGeminiVoiceProfile(
  model: string,
  mode: GeminiTranscribeLanguageProfile,
): GeminiLiveConnectionProfile | null {
  if (model === TRACKER_VOICE_GEMINI_TRANSCRIBE_MODEL) return buildGeminiTranscribeProfile(mode);
  if (model !== TRACKER_VOICE_GEMINI_LEGACY_MODEL) return null;
  return {
    model,
    config: {
      responseModalities: ["AUDIO"],
      inputAudioTranscription: {
        languageCodes: mode === "auto" ? [] : ["vi-VN", "en-US"],
        customVocabulary: [...TRACKER_VOICE_GEMINI_TRANSCRIBE_VOCABULARY],
      },
      realtimeInputConfig: automaticVadConfig(),
    },
  };
}

/** A resumption handle is accepted only after Gemini returned it for this live provider instance. */
export function buildGeminiLiveConnectConfig(
  profile: GeminiLiveConnectionProfile,
  sessionResumptionHandle: string | null,
): Record<string, unknown> {
  return {
    ...profile.config,
    sessionResumption: sessionResumptionHandle ? { handle: sessionResumptionHandle } : {},
  };
}

export function buildGeminiEphemeralTokenRequest(
  now: number,
  profile: GeminiLiveConnectionProfile,
): Record<string, unknown> {
  const { responseModalities, ...liveConfig } = profile.config;
  return {
    uses: 1,
    newSessionExpireTime: new Date(now + 60_000).toISOString(),
    expireTime: new Date(now + 20 * 60_000).toISOString(),
    // This is the auth_tokens wire format. The JS SDK accepts
    // liveConnectConstraints and serializes it to bidiGenerateContentSetup.
    bidiGenerateContentSetup: {
      model: `models/${profile.model}`,
      ...(Array.isArray(responseModalities)
        ? { generationConfig: { responseModalities } }
        : {}),
      ...liveConfig,
    },
  };
}
