import { describe, expect, it } from "vitest";

import {
  buildGeminiEphemeralTokenRequest,
  buildGeminiTranscribeProfile,
  parseGeminiTranscribeLanguageProfile,
  TRACKER_VOICE_GEMINI_TRANSCRIBE_MODEL,
  TRACKER_VOICE_GEMINI_TRANSCRIBE_VOCABULARY,
} from "./geminiTranscribeProfile";

describe("Gemini Transcribe profile", () => {
  it("allows only the two reviewed profile enums", () => {
    expect(parseGeminiTranscribeLanguageProfile("auto")).toBe("auto");
    expect(parseGeminiTranscribeLanguageProfile("vi_en")).toBe("vi_en");
    expect(parseGeminiTranscribeLanguageProfile("TRUE")).toBeNull();
    expect(parseGeminiTranscribeLanguageProfile("anything")).toBeNull();
  });

  it("locks the dedicated model, text-only transcription, VERBATIM, VAD and canonical vocabulary", () => {
    const profile = buildGeminiTranscribeProfile("auto");
    expect(profile).toMatchObject({
      model: TRACKER_VOICE_GEMINI_TRANSCRIBE_MODEL,
      config: {
        responseModalities: ["TEXT"],
        inputAudioTranscription: { languageCodes: [], mode: "VERBATIM" },
        realtimeInputConfig: { automaticActivityDetection: { disabled: false, prefixPaddingMs: 300, silenceDurationMs: 600 } },
      },
    });
    expect(TRACKER_VOICE_GEMINI_TRANSCRIBE_VOCABULARY).not.toEqual(expect.arrayContaining(["fit", "feet", "rây", "phâu", "ô in"]));
    expect(TRACKER_VOICE_GEMINI_TRANSCRIBE_VOCABULARY).toEqual(expect.arrayContaining([
      "nghìn",
      "triệu",
      "raise 120 nghìn",
      "raise một trăm hai mươi nghìn",
      "raise one hundred twenty thousand",
      "raise 1000",
      "seat four raise 1000",
      "cược hai trăm nghìn",
    ]));
    expect(TRACKER_VOICE_GEMINI_TRANSCRIBE_VOCABULARY.length).toBeLessThan(100);
  });

  it("binds an ephemeral token to the exact reviewed model and config", () => {
    const profile = buildGeminiTranscribeProfile("vi_en");
    expect(buildGeminiEphemeralTokenRequest(1_000, profile)).toMatchObject({
      uses: 1,
      bidiGenerateContentSetup: {
        model: `models/${TRACKER_VOICE_GEMINI_TRANSCRIBE_MODEL}`,
        generationConfig: { responseModalities: ["TEXT"] },
        inputAudioTranscription: profile.config.inputAudioTranscription,
        realtimeInputConfig: profile.config.realtimeInputConfig,
      },
    });
  });
});
