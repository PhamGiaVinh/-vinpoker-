import { describe, it, expect } from "vitest";
import { classifyCandidate } from "../rotationEligibility";

const NOW = 1_750_000_000_000; // fixed epoch
const MIN = 60_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

const base = {
  currentState: "available",
  attendanceStatus: "checked_in",
  restMinutes: 10,
  nowMs: NOW,
};

describe("classifyCandidate", () => {
  it("available with rest complete → ready_now", () => {
    const r = classifyCandidate({
      ...base,
      lastReleasedAt: iso(NOW - 20 * MIN), // eligible 10 min ago
      plannedReliefAtMs: NOW + 15 * MIN,
    });
    expect(r.group).toBe("ready_now");
  });

  it("no release recorded → ready_now (treated as long-rested)", () => {
    const r = classifyCandidate({
      ...base,
      lastReleasedAt: null,
      plannedReliefAtMs: NOW + 15 * MIN,
    });
    expect(r.group).toBe("ready_now");
    expect(r.eligibleAtMs).toBeNull();
  });

  it("owner example ALLOWED: rested 5/10 min, swing in 15 → eligible_before_swing", () => {
    // Now 12:00, released 11:55 → rest done 12:05, +3min buffer = 12:08 <= swing 12:15.
    const r = classifyCandidate({
      ...base,
      lastReleasedAt: iso(NOW - 5 * MIN),
      plannedReliefAtMs: NOW + 15 * MIN,
    });
    expect(r.group).toBe("eligible_before_swing");
    expect(r.eligibleAtMs).toBe(NOW + 5 * MIN);
    expect(r.earliestEntryMs).toBe(NOW + 8 * MIN);
  });

  it("owner example BLOCKED: rest+buffer done 12:08 but swing 12:06 → resting_not_eligible", () => {
    const r = classifyCandidate({
      ...base,
      lastReleasedAt: iso(NOW - 5 * MIN), // entry possible at +8min
      plannedReliefAtMs: NOW + 6 * MIN, // swing before that
    });
    expect(r.group).toBe("resting_not_eligible");
  });

  it("boundary: rest+buffer lands EXACTLY on the planned swing → eligible", () => {
    const r = classifyCandidate({
      ...base,
      lastReleasedAt: iso(NOW - 5 * MIN), // earliest entry = NOW+8min
      plannedReliefAtMs: NOW + 8 * MIN,
    });
    expect(r.group).toBe("eligible_before_swing");
  });

  it("fully-rested dealer stays eligible for an OVERDUE table (planned time in the past)", () => {
    const r = classifyCandidate({
      ...base,
      lastReleasedAt: iso(NOW - 30 * MIN),
      plannedReliefAtMs: NOW - 5 * MIN, // overdue
    });
    expect(r.group).toBe("ready_now");
  });

  it("still-resting dealer is NOT eligible for an overdue table", () => {
    const r = classifyCandidate({
      ...base,
      lastReleasedAt: iso(NOW - 2 * MIN),
      plannedReliefAtMs: NOW - 5 * MIN, // overdue — can't make a time already past
    });
    expect(r.group).toBe("resting_not_eligible");
  });

  it("busy states win over time eligibility", () => {
    expect(
      classifyCandidate({ ...base, currentState: "assigned", lastReleasedAt: null, plannedReliefAtMs: NOW + 15 * MIN }).group
    ).toBe("busy_assigned");
    expect(
      classifyCandidate({ ...base, currentState: "pre_assigned", lastReleasedAt: null, plannedReliefAtMs: NOW + 15 * MIN }).group
    ).toBe("busy_pre_assigned");
    expect(
      classifyCandidate({ ...base, currentState: "on_break", lastReleasedAt: null, plannedReliefAtMs: NOW + 15 * MIN }).group
    ).toBe("on_break");
  });

  it("checked-out dealer is unavailable regardless of state", () => {
    const r = classifyCandidate({
      ...base,
      attendanceStatus: "checked_out",
      lastReleasedAt: null,
      plannedReliefAtMs: NOW + 15 * MIN,
    });
    expect(r.group).toBe("unavailable");
  });

  it("custom rest minutes are honored (12-min club)", () => {
    const r = classifyCandidate({
      ...base,
      restMinutes: 12,
      lastReleasedAt: iso(NOW - 5 * MIN), // entry at +10min (7 rest left + 3 buffer)
      plannedReliefAtMs: NOW + 9 * MIN,
    });
    expect(r.group).toBe("resting_not_eligible");
  });
});
