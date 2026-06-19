import { describe, it, expect } from "vitest";
import {
  getEffectiveStart,
  getLateRegCloseTime,
  getCurrentLevel,
  isLateRegClosed,
} from "@/lib/tournamentLive";

// Regression for: a tournament started later than its planned start_time vanished
// from the public registration list because late-reg was computed off the stale
// planned start_time instead of the actual clock start.

const MIN = 60_000;
const planned = "2026-06-19T13:00:00.000Z"; // 20:00 local-ish — the PLANNED time
const plannedMs = new Date(planned).getTime();

describe("tournamentLive — clock_started_at anchoring", () => {
  it("getEffectiveStart falls back to start_time when the clock hasn't started", () => {
    expect(getEffectiveStart({ start_time: planned })).toBe(plannedMs);
    expect(getEffectiveStart({ start_time: planned, clock_started_at: null })).toBe(plannedMs);
  });

  it("getEffectiveStart uses clock_started_at once the clock is running", () => {
    const startedAt = "2026-06-19T15:00:00.000Z"; // started 2h after planned
    expect(getEffectiveStart({ start_time: planned, clock_started_at: startedAt })).toBe(
      new Date(startedAt).getTime(),
    );
  });

  it("ROOT CAUSE: a tournament started 3h after its planned time is wrongly late-reg-closed off start_time, but OPEN off the clock", () => {
    const t = {
      start_time: planned,
      minutes_per_level: 20,
      late_reg_close_level: 6, // closes 120 min after the real start
      live_status: "running",
    };
    const now = plannedMs + 3 * 60 * MIN; // 3h after the planned time

    // Without a clock anchor, late-reg looks closed (120 min < 180 min elapsed).
    expect(isLateRegClosed(t, now)).toBe(true);

    // With the clock started "now", late-reg is genuinely still open for 120 min.
    const live = { ...t, clock_started_at: new Date(now).toISOString() };
    expect(isLateRegClosed(live, now)).toBe(false);
    expect(getLateRegCloseTime(live).getTime()).toBe(now + 120 * MIN);
  });

  it("level counts from the clock start, not the planned time", () => {
    const startedAt = plannedMs + 2 * 60 * MIN;
    const t = {
      start_time: planned,
      minutes_per_level: 20,
      clock_started_at: new Date(startedAt).toISOString(),
    };
    // 25 min into the real clock = level 2, regardless of the 2h-old planned time.
    expect(getCurrentLevel(t, startedAt + 25 * MIN)).toBe(2);
  });

  it("finished tournaments stay closed regardless of the clock", () => {
    expect(
      isLateRegClosed(
        { start_time: planned, live_status: "finished", clock_started_at: new Date().toISOString() },
        plannedMs,
      ),
    ).toBe(true);
  });
});
