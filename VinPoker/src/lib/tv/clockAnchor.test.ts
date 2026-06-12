import { describe, expect, it } from "vitest";
import { displayedRemaining, type ClockAnchor } from "./clockAnchor";

const anchor = (overrides: Partial<ClockAnchor> = {}): ClockAnchor => ({
  remainingAtFetch: 600,
  anchorMs: 10_000,
  isRunning: true,
  ...overrides,
});

describe("displayedRemaining", () => {
  it("returns 0 with no anchor", () => {
    expect(displayedRemaining(null, 99_999)).toBe(0);
  });

  it("subtracts monotonic elapsed time while running", () => {
    expect(displayedRemaining(anchor(), 10_000)).toBe(600);
    expect(displayedRemaining(anchor(), 25_000)).toBe(585);
    expect(displayedRemaining(anchor(), 10_500)).toBe(600); // rounds, no jitter
  });

  it("clamps at zero instead of going negative", () => {
    expect(displayedRemaining(anchor(), 10_000 + 601_000)).toBe(0);
    expect(displayedRemaining(anchor(), 10_000 + 9_999_000)).toBe(0);
  });

  it("freezes at the fetched value when paused", () => {
    const paused = anchor({ isRunning: false, remainingAtFetch: 123 });
    expect(displayedRemaining(paused, 10_000)).toBe(123);
    expect(displayedRemaining(paused, 500_000)).toBe(123);
  });
});
