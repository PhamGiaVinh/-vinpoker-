import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canUseTrackerAtomicResettle, FEATURES } from "@/lib/featureFlags";

const handHistoryPath = resolve(process.cwd(), "src/components/cashier/tournament-live/HandHistoryWorkspace.tsx");
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
    const invoke = handHistorySource.indexOf('supabase.functions.invoke("tournament-live-resettle-commit"');
    expect(guard).toBeGreaterThan(-1);
    expect(invoke).toBeGreaterThan(guard);
  });

  it("does not send client-selected winners or mucks to the atomic writer", () => {
    const manualWinnerGuard = handHistorySource.indexOf("rv.editedTarget.manualWinnerIds");
    const serverEdit = handHistorySource.indexOf("const serverEdit = buildServerSettlementEdit(rv.patch)");
    const invoke = handHistorySource.indexOf('supabase.functions.invoke("tournament-live-resettle-commit"');
    expect(manualWinnerGuard).toBeGreaterThan(-1);
    expect(serverEdit).toBeGreaterThan(manualWinnerGuard);
    expect(invoke).toBeGreaterThan(serverEdit);
  });
});
