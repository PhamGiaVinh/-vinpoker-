import { describe, expect, it } from "vitest";
import { createHandHistoryLoadGuard } from "@/components/cashier/tournament-live/handHistoryLoadGuard";

describe("hand-history load guard", () => {
  it("rejects a late response from the previous table after a new selection starts", () => {
    const guard = createHandHistoryLoadGuard();
    const tableA = guard.begin();
    const tableB = guard.begin();

    expect(guard.isCurrent(tableA)).toBe(false);
    expect(guard.isCurrent(tableB)).toBe(true);
  });

  it("invalidates an in-flight response when the panel unmounts", () => {
    const guard = createHandHistoryLoadGuard();
    const request = guard.begin();
    guard.invalidate();

    expect(guard.isCurrent(request)).toBe(false);
  });
});
