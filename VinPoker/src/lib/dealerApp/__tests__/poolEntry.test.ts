import { describe, it, expect } from "vitest";
import { poolEntryInfo } from "../selectors";

// pool_entry_at = greatest(scheduledStart, arrival); early arrival is "pending"
// until the scheduled start. Mirrors the server rule in _dealer_record_checkin.
const base = {
  scheduledStartAt: "2026-06-17T15:00:00Z",
  status: "checked_in" as const,
};

describe("poolEntryInfo", () => {
  it("early arrival → pending until scheduled start; pool entry = scheduled start", () => {
    const r = poolEntryInfo({ ...base, checkedInAt: "2026-06-17T14:45:00Z" }, "2026-06-17T14:50:00Z");
    expect(r.poolEntryAt).toBe("2026-06-17T15:00:00Z");
    expect(r.pending).toBe(true);
  });

  it("early arrival but now past scheduled start → no longer pending", () => {
    const r = poolEntryInfo({ ...base, checkedInAt: "2026-06-17T14:45:00Z" }, "2026-06-17T15:01:00Z");
    expect(r.poolEntryAt).toBe("2026-06-17T15:00:00Z");
    expect(r.pending).toBe(false);
  });

  it("late arrival → pool entry = arrival, not pending", () => {
    const r = poolEntryInfo({ ...base, checkedInAt: "2026-06-17T15:10:00Z" }, "2026-06-17T15:11:00Z");
    expect(r.poolEntryAt).toBe("2026-06-17T15:10:00Z");
    expect(r.pending).toBe(false);
  });

  it("not yet checked in → never pending", () => {
    const r = poolEntryInfo(
      { scheduledStartAt: "2026-06-17T15:00:00Z", status: "confirmed", checkedInAt: null },
      "2026-06-17T14:50:00Z"
    );
    expect(r.pending).toBe(false);
  });
});
