import { describe, expect, it } from "vitest";
import { canShowOwnerDailyDigestMenu } from "@/ops/digest/ownerDailyDigestMenuGate";

describe("Owner Daily Digest legacy menu gate", () => {
  it("allows Super Admin preview while the production flag remains off", () => {
    expect(canShowOwnerDailyDigestMenu({ isAdmin: true, isClubOwner: false, featureEnabled: false })).toBe(true);
  });

  it("shows club Owners only after the production feature is enabled", () => {
    expect(canShowOwnerDailyDigestMenu({ isAdmin: false, isClubOwner: true, featureEnabled: false })).toBe(false);
    expect(canShowOwnerDailyDigestMenu({ isAdmin: false, isClubOwner: true, featureEnabled: true })).toBe(true);
  });

  it("never exposes the entry to an unrelated player", () => {
    expect(canShowOwnerDailyDigestMenu({ isAdmin: false, isClubOwner: false, featureEnabled: true })).toBe(false);
  });
});
