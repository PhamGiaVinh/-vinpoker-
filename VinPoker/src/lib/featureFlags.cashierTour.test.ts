import { describe, expect, it } from "vitest";
import { isTourCashierBuildEnabled } from "./featureFlags";

describe("Tour Cashier build gate", () => {
  it("opens only for the exact Cashier production value, independent of global preview", () => {
    expect(isTourCashierBuildEnabled("production")).toBe(true);
    for (const value of [undefined, null, true, "true", "preview", "enabled", "PRODUCTION", ""]) {
      expect(isTourCashierBuildEnabled(value)).toBe(false);
    }
  });
});
