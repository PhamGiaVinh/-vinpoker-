import {
  AudioTranscriptionConfigMode,
  Modality,
  type LiveConnectConfig,
} from "@google/genai";
import { describe, expect, it } from "vitest";

describe("Gemini Live Transcribe SDK capability", () => {
  it("types the reviewed 3.5 transcription and VAD fields with the pinned SDK", () => {
    const config: LiveConnectConfig = {
      responseModalities: [Modality.TEXT],
      inputAudioTranscription: {
        languageCodes: [],
        customVocabulary: ["seat nine", "raise 120k"],
        mode: AudioTranscriptionConfigMode.VERBATIM,
      },
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          prefixPaddingMs: 300,
          silenceDurationMs: 600,
        },
      },
    };

    expect(config.inputAudioTranscription?.mode).toBe("VERBATIM");
    expect(config.responseModalities).toEqual(["TEXT"]);
  });
});
