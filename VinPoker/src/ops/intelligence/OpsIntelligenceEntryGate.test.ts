import { describe, expect, it } from "vitest";
import { isOpsIntelligenceCommandCenterEnabled, shouldReadTrackerAlerts } from "./opsIntelligenceGate";

describe("Ops Intelligence flag gate", () => {
  it("keeps the production path dark even when an E2E value is present", () => {
    expect(isOpsIntelligenceCommandCenterEnabled(false, { dev: false, e2eFlag: "true" })).toBe(false);
  });

  it("permits the explicit local E2E override only in development", () => {
    expect(isOpsIntelligenceCommandCenterEnabled(false, { dev: true, e2eFlag: "true" })).toBe(true);
  });

  it("keeps Tracker unread when its rollout is disabled", () => {
    expect(shouldReadTrackerAlerts(false, ["event-1"])).toBe(false);
    expect(shouldReadTrackerAlerts(true, [])).toBe(false);
    expect(shouldReadTrackerAlerts(true, ["event-1"])).toBe(true);
  });
});
