import { describe, expect, it } from "vitest";
import { isPublicSpectatorLastHandHistoryEnabled } from "./featureFlags";

describe("public spectator last-hand history rollout gate", () => {
  it("fails closed unless an exact reviewed environment pair is supplied", () => {
    expect(isPublicSpectatorLastHandHistoryEnabled()).toBe(false);
    expect(isPublicSpectatorLastHandHistoryEnabled("true", "preview")).toBe(false);
    expect(isPublicSpectatorLastHandHistoryEnabled("preview", "production")).toBe(false);
    expect(isPublicSpectatorLastHandHistoryEnabled("preview", "preview")).toBe(true);
    expect(isPublicSpectatorLastHandHistoryEnabled("production", "production")).toBe(true);
  });
});
