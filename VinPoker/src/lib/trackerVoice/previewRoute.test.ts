import { describe, expect, it } from "vitest";

import { isTrackerVoiceUatRoute } from "./previewRoute";

describe("tracker voice UAT route", () => {
  it("only exposes the diagnostic routes when the build-time UAT flag is enabled", () => {
    expect(isTrackerVoiceUatRoute("/__uat/tracker-voice", true)).toBe(true);
    expect(isTrackerVoiceUatRoute("/__dev/tracker-voice-uat", true)).toBe(true);
    expect(isTrackerVoiceUatRoute("/__uat/tracker-voice", false)).toBe(false);
    expect(isTrackerVoiceUatRoute("/tracker/hand-input", true)).toBe(false);
  });
});
