import { describe, expect, it } from "vitest";
import { shouldCollectCommittedChips } from "./livePotCollection";

describe("shouldCollectCommittedChips", () => {
  it("collects a completed all-in hand with a full board", () => {
    expect(shouldCollectCommittedChips({
      enabled: true,
      runout: false,
      finalAllIn: true,
      hasCommittedChips: true,
    })).toBe(true);
  });

  it("keeps the live runout path enabled", () => {
    expect(shouldCollectCommittedChips({
      enabled: true,
      runout: true,
      finalAllIn: false,
      hasCommittedChips: true,
    })).toBe(true);
  });

  it("fails closed before the final all-in state or without chips", () => {
    expect(shouldCollectCommittedChips({
      enabled: true,
      runout: false,
      finalAllIn: false,
      hasCommittedChips: true,
    })).toBe(false);
    expect(shouldCollectCommittedChips({
      enabled: true,
      runout: false,
      finalAllIn: true,
      hasCommittedChips: false,
    })).toBe(false);
  });
});
