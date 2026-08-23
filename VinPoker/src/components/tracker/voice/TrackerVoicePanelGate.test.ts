import { describe, expect, it } from "vitest";

import type { TrackerVoiceRuntimeContext } from "@/lib/trackerVoice";
import { isTrackerVoiceUiEnabled } from "@/lib/trackerVoice/uiGate";

function runtimeFixture(overrides: Partial<TrackerVoiceRuntimeContext> = {}): TrackerVoiceRuntimeContext {
  return {
    ok: true,
    can_mint_session: true,
    read_only: false,
    correction_pending: false,
    config: {
      enabled: true,
      configured_mode: "shadow",
      provider_model: "gemini-3.1-flash-live-preview",
      spoken_amount_unit: 1,
      amount_unit_confirmed: false,
      provider_confidence_threshold: null,
      server_auto_allowed: false,
      correction_state: "ready",
    },
    active_hand: null,
    ...overrides,
  };
}

describe("isTrackerVoiceUiEnabled", () => {
  it("only opens the Voice surface for a server-enabled writable assignment", () => {
    expect(isTrackerVoiceUiEnabled(runtimeFixture())).toBe(true);
    expect(isTrackerVoiceUiEnabled(runtimeFixture({ read_only: true }))).toBe(false);
    expect(isTrackerVoiceUiEnabled(runtimeFixture({ ok: false }))).toBe(false);
  });

  it("keeps disabled and malformed server contexts hidden", () => {
    expect(isTrackerVoiceUiEnabled(runtimeFixture({
      config: { ...runtimeFixture().config, enabled: false },
    }))).toBe(false);
    expect(isTrackerVoiceUiEnabled(null)).toBe(false);
  });
});
