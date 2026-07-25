import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { getPtWageAccrualPresentation } from "../../src/lib/dealerPtWagePresentation.ts";

Deno.test("continuous standby mode permits an in-between-refresh display estimate", () => {
  const result = getPtWageAccrualPresentation({
    current_shift_open: true,
    accrual_mode: "continuous_standby",
    standby_accrual_enabled: true,
    live_accrual_active: true,
  });

  assertEquals(result.isLiveAccruing, true);
  assertStringIncludes(result.label, "pool");
});

Deno.test("server-reported 24-hour cap prevents a misleading local estimate", () => {
  const result = getPtWageAccrualPresentation({
    current_shift_open: true,
    accrual_mode: "capped_24h",
    current_shift_cap_reached: true,
    live_accrual_active: false,
  });

  assertEquals(result.isLiveAccruing, false);
  assertStringIncludes(result.label, "24");
});

Deno.test("old RPC payloads retain the existing display behavior until the server contract arrives", () => {
  assertEquals(
    getPtWageAccrualPresentation({ current_shift_open: true }).isLiveAccruing,
    true,
  );
  assertEquals(
    getPtWageAccrualPresentation({ current_shift_open: false }).isLiveAccruing,
    false,
  );
});
