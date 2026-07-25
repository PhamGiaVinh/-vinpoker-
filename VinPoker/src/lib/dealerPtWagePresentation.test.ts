import { describe, expect, it } from "vitest";
import { getPtWageAccrualPresentation } from "./dealerPtWagePresentation";

describe("getPtWageAccrualPresentation", () => {
  it("shows continuous standby accrual only when the server policy enables it", () => {
    const result = getPtWageAccrualPresentation({
      current_shift_open: true,
      accrual_mode: "continuous_standby",
      standby_accrual_enabled: true,
      live_accrual_active: true,
    });

    expect(result.mode).toBe("continuous_standby");
    expect(result.isLiveAccruing).toBe(true);
    expect(result.label).toContain("pool");
  });

  it("does not show a client-side increase after the server reports the legacy cap", () => {
    const result = getPtWageAccrualPresentation({
      current_shift_open: true,
      accrual_mode: "capped_24h",
      current_shift_cap_reached: true,
      live_accrual_active: false,
    });

    expect(result.mode).toBe("capped_24h");
    expect(result.isLiveAccruing).toBe(false);
    expect(result.label).toContain("24");
  });

  it("keeps the previous display behavior while an older server contract is still in use", () => {
    const result = getPtWageAccrualPresentation({ current_shift_open: true });

    expect(result.mode).toBe("capped_24h");
    expect(result.isLiveAccruing).toBe(true);
  });

  it("never starts a local estimate for a closed attendance", () => {
    const result = getPtWageAccrualPresentation({
      current_shift_open: false,
      accrual_mode: "continuous_standby",
      standby_accrual_enabled: true,
    });

    expect(result.isLiveAccruing).toBe(false);
  });
});
