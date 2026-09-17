import { describe, expect, it } from "vitest";
import { isPublicSpectatorLastHandHistoryPreviewEnabled } from "./featureFlags";

describe("public spectator last-hand history rollout gate", () => {
  it("fails closed unless both preview values are exact", () => {
    expect(isPublicSpectatorLastHandHistoryPreviewEnabled()).toBe(false);
    expect(isPublicSpectatorLastHandHistoryPreviewEnabled("true", "preview")).toBe(false);
    expect(isPublicSpectatorLastHandHistoryPreviewEnabled("preview", "production")).toBe(false);
    expect(isPublicSpectatorLastHandHistoryPreviewEnabled("preview", "preview")).toBe(true);
  });
});
