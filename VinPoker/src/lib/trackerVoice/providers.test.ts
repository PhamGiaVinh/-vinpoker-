import { describe, expect, it } from "vitest";

import {
  EMPTY_GEMINI_LIVE_AUDIO_READINESS,
  expireGeminiTranscriptFlush,
  GEMINI_LIVE_INPUT_LANGUAGE_CODES,
  isGeminiLiveConnectionCurrent,
  isGeminiLiveListeningReady,
  isTrackerVoiceGeminiLiveModel,
  reduceGeminiTranscriptMessage,
  resolveGeminiFlushStatus,
  resumeGeminiLiveAudioContext,
  TRACKER_VOICE_GEMINI_LIVE_MODEL,
  TRACKER_VOICE_GEMINI_CUSTOM_VOCABULARY,
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

describe("Gemini Live microphone readiness", () => {
  it("does not call a socket-only session listening while Safari audio is suspended", () => {
    expect(isGeminiLiveListeningReady({
      ...EMPTY_GEMINI_LIVE_AUDIO_READINESS,
      microphonePermissionGranted: true,
      streamLive: true,
      socketReady: true,
      captureReady: true,
      pcmFrameDelivered: true,
      audioContextRunning: false,
    })).toBe(false);
  });

  it("allows listening only after stream, PCM capture, running audio, and a delivered frame", () => {
    expect(isGeminiLiveListeningReady({
      microphonePermissionGranted: true,
      streamLive: true,
      socketReady: true,
      audioContextRunning: true,
      captureReady: true,
      pcmFrameDelivered: true,
    })).toBe(true);
  });

  it("fails visibly when AudioContext resume leaves Safari suspended", async () => {
    await expect(resumeGeminiLiveAudioContext({
      state: "suspended" as AudioContextState,
      resume: async () => undefined,
    })).rejects.toThrow("MIC_AUDIO_CONTEXT_SUSPENDED");
  });

  it("ignores an old socket callback after a newer generation starts", () => {
    expect(isGeminiLiveConnectionCurrent(4, 5, true)).toBe(false);
    expect(isGeminiLiveConnectionCurrent(5, 5, true)).toBe(true);
    expect(isGeminiLiveConnectionCurrent(5, 5, false)).toBe(false);
  });
});

describe("Gemini Live final transcript flush", () => {
  it("preserves a delayed final transcript after the microphone stops", () => {
    const pending = reduceGeminiTranscriptMessage(emptyState(), {
      serverContent: { inputTranscription: { text: "raise 120k" } },
    }, "2026-08-24T00:00:00.000Z");
    const delayedFinal = reduceGeminiTranscriptMessage(pending.state, {
      serverContent: { turnComplete: true },
    }, "2026-08-24T00:00:01.000Z");

    expect(delayedFinal.events).toHaveLength(1);
    expect(delayedFinal.events[0]).toMatchObject({ transcript: "raise 120k", isFinal: true });
    expect(resolveGeminiFlushStatus("flushing", delayedFinal.events)).toBe("paused");
  });

  it("handles turnComplete before the delayed final transcript exactly once", () => {
    const completed = reduceGeminiTranscriptMessage(emptyState(), {
      serverContent: { turnComplete: true },
    }, "2026-08-24T00:00:00.000Z");
    const delayedFinal = reduceGeminiTranscriptMessage(completed.state, {
      serverContent: { inputTranscription: { text: "bỏ bài" } },
    }, "2026-08-24T00:00:01.000Z");

    expect(delayedFinal.events).toHaveLength(1);
    expect(delayedFinal.events[0]).toMatchObject({ transcript: "bỏ bài", isFinal: true });
  });

  it("drops partial-only text on timeout without inventing a final command", () => {
    const partial = reduceGeminiTranscriptMessage(emptyState(), {
      serverContent: { interimInputTranscription: { text: "raise" } },
    }, "2026-08-24T00:00:00.000Z");
    const expired = expireGeminiTranscriptFlush(partial.state);
    const afterTimeout = reduceGeminiTranscriptMessage(expired, {
      serverContent: { turnComplete: true },
    }, "2026-08-24T00:00:01.000Z");

    expect(afterTimeout.events).toEqual([]);
    expect(resolveGeminiFlushStatus("flushing", afterTimeout.events)).toBe("flushing");
  });
});

describe("Gemini Live dealer phrase adaptation", () => {
  it("uses only the supported language hint and custom vocabulary fields", () => {
    expect(GEMINI_LIVE_INPUT_LANGUAGE_CODES).toEqual(["vi-VN", "en-US"]);
    expect(TRACKER_VOICE_GEMINI_CUSTOM_VOCABULARY).toEqual(expect.arrayContaining([
      "raise 120k",
      "rây một trăm hai mươi nghìn",
      "seat five",
      "seat number five",
      "sít năm",
      "ghế số năm",
      "ô in",
      "tất tay",
    ]));
    expect(TRACKER_VOICE_GEMINI_CUSTOM_VOCABULARY.length).toBeGreaterThanOrEqual(40);
    expect(TRACKER_VOICE_GEMINI_CUSTOM_VOCABULARY.length).toBeLessThanOrEqual(80);
  });
});
