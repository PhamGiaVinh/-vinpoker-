import { describe, expect, it } from "vitest";
import { isReplaySettlementPayoutPhase } from "./replayRunoutTimeline";

describe("replay settlement payout phases", () => {
  it("keeps committed chips collected through the final static frame", () => {
    expect(isReplaySettlementPayoutPhase("pot_collect")).toBe(true);
    expect(isReplaySettlementPayoutPhase("pot_award")).toBe(true);
    expect(isReplaySettlementPayoutPhase("dim")).toBe(true);
    expect(isReplaySettlementPayoutPhase("glow")).toBe(true);
    expect(isReplaySettlementPayoutPhase("summary_delay")).toBe(true);
    expect(isReplaySettlementPayoutPhase("summary")).toBe(true);
    expect(isReplaySettlementPayoutPhase("static")).toBe(true);
  });

  it("does not collect seat chips before the payout sequence starts", () => {
    expect(isReplaySettlementPayoutPhase("hole_hold")).toBe(false);
    expect(isReplaySettlementPayoutPhase("flop")).toBe(false);
    expect(isReplaySettlementPayoutPhase("turn")).toBe(false);
    expect(isReplaySettlementPayoutPhase("river")).toBe(false);
    expect(isReplaySettlementPayoutPhase(null)).toBe(false);
  });
});
