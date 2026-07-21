import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canUseTrackerAtomicResettle, FEATURES } from "@/lib/featureFlags";

const handHistoryPath = resolve(process.cwd(), "src/components/cashier/tournament-live/HandHistoryPanel.tsx");
const handHistorySource = readFileSync(handHistoryPath, "utf8");

describe("tracker atomic resettle capability gate", () => {
  it("requires both the source flag and deployment acknowledgement", () => {
    expect(canUseTrackerAtomicResettle(false, false)).toBe(false);
    expect(canUseTrackerAtomicResettle(false, true)).toBe(false);
    expect(canUseTrackerAtomicResettle(true, false)).toBe(false);
    expect(canUseTrackerAtomicResettle(true, true)).toBe(true);
  });

  it("defaults the source flag off", () => {
    expect(FEATURES.trackerAtomicResettle).toBe(false);
  });

  it("checks capability before the atomic Edge invocation", () => {
    const guard = handHistorySource.indexOf("if (!isTrackerAtomicResettleAvailable())");
    const invoke = handHistorySource.indexOf('supabase.functions.invoke("tournament-live-resettle"');
    expect(guard).toBeGreaterThan(-1);
    expect(invoke).toBeGreaterThan(guard);
  });
});
