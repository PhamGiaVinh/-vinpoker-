import { describe, expect, it } from "vitest";

import {
  isTrackerVoiceGeminiLiveModel,
  TRACKER_VOICE_GEMINI_LIVE_MODEL,
} from "./providers";

describe("Tracker Voice provider selection", () => {
  it("selects Gemini only for the server allowlisted Live model", () => {
    expect(isTrackerVoiceGeminiLiveModel(TRACKER_VOICE_GEMINI_LIVE_MODEL)).toBe(true);
    expect(isTrackerVoiceGeminiLiveModel("gemini-3.1-flash-live-preview-extra")).toBe(false);
    expect(isTrackerVoiceGeminiLiveModel("gpt-live-transcribe")).toBe(false);
    expect(isTrackerVoiceGeminiLiveModel(null)).toBe(false);
  });
});
