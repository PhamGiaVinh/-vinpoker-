import { describe, expect, it } from "vitest";

import {
  isTrackerVoiceGeminiLiveModel,
  reduceGeminiTranscriptMessage,
  TRACKER_VOICE_GEMINI_LIVE_MODEL,
  type GeminiTranscriptState,
} from "./providers";

const emptyState = (): GeminiTranscriptState => ({
  workingTranscript: "",
  confirmedTranscript: "",
  turnCompleteSeen: false,
  finalCount: 0,
});

describe("Tracker Voice provider selection", () => {
  it("selects Gemini only for the server allowlisted Live model", () => {
    expect(isTrackerVoiceGeminiLiveModel(TRACKER_VOICE_GEMINI_LIVE_MODEL)).toBe(true);
    expect(isTrackerVoiceGeminiLiveModel("gemini-3.1-flash-live-preview-extra")).toBe(false);
    expect(isTrackerVoiceGeminiLiveModel("gpt-live-transcribe")).toBe(false);
    expect(isTrackerVoiceGeminiLiveModel(null)).toBe(false);
  });

  it("finalizes when confirmed transcription arrives before turnComplete", () => {
    const transcript = reduceGeminiTranscriptMessage(emptyState(), {
      serverContent: { inputTranscription: { text: "raise 120k" } },
    }, "2026-08-24T00:00:00.000Z");
    expect(transcript.events).toMatchObject([{ transcript: "raise 120k", isFinal: false }]);

    const completed = reduceGeminiTranscriptMessage(transcript.state, {
      serverContent: { turnComplete: true },
    }, "2026-08-24T00:00:01.000Z");
    expect(completed.events).toEqual([{
      providerEventId: "gemini-live:1",
      transcript: "raise 120k",
      isFinal: true,
      capturedAt: "2026-08-24T00:00:01.000Z",
    }]);
  });

  it("finalizes when turnComplete arrives before the independent transcription", () => {
    const completed = reduceGeminiTranscriptMessage(emptyState(), {
      serverContent: { turnComplete: true },
    }, "2026-08-24T00:00:00.000Z");
    expect(completed.events).toEqual([]);

    const transcript = reduceGeminiTranscriptMessage(completed.state, {
      serverContent: { inputTranscription: { text: "bỏ bài" } },
    }, "2026-08-24T00:00:01.000Z");
    expect(transcript.events).toEqual([{
      providerEventId: "gemini-live:1",
      transcript: "bỏ bài",
      isFinal: true,
      capturedAt: "2026-08-24T00:00:01.000Z",
    }]);
  });

  it("never promotes interim-only text to a final command", () => {
    const partial = reduceGeminiTranscriptMessage(emptyState(), {
      serverContent: {
        interimInputTranscription: { text: "all" },
        turnComplete: true,
      },
    }, "2026-08-24T00:00:00.000Z");
    expect(partial.events).toMatchObject([{ transcript: "all", isFinal: false }]);
    expect(partial.state.confirmedTranscript).toBe("");
  });
});
