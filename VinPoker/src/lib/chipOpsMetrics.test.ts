import { describe, expect, it } from "vitest";
import { deriveTournamentChipMetrics } from "./chipOpsMetrics";

describe("deriveTournamentChipMetrics", () => {
  it("derives table chips and average only from a complete active-seat snapshot", () => {
    expect(deriveTournamentChipMetrics([10_000, 20_000, 30_000], 3)).toEqual({
      activeSeatCount: 3,
      tableChipTotal: 60_000,
      averageStack: 20_000,
      rosterQuality: "exact",
    });
  });

  it("fails closed when players remaining disagrees with active seats", () => {
    expect(deriveTournamentChipMetrics([10_000, 20_000], 3)).toEqual({
      activeSeatCount: 2,
      tableChipTotal: 30_000,
      averageStack: null,
      rosterQuality: "partial",
    });
  });

  it("does not treat malformed stacks as a complete snapshot", () => {
    expect(deriveTournamentChipMetrics([10_000, -1], 1)).toMatchObject({
      activeSeatCount: 1,
      tableChipTotal: 10_000,
      averageStack: null,
      rosterQuality: "partial",
    });
  });
});
