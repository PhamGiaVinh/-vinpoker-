import { describe, expect, it } from "vitest";
import { parseHistoricalSettlementDisplayPreview } from "@/lib/tracker-poker/historicalSettlementDisplay";

const hash = "a".repeat(64);

function preview(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: "preview",
    hand_id: "hand-4",
    source_revision: 3,
    source_chain_hash: hash,
    outcome_hash: "b".repeat(64),
    public_outcome: {
      schemaVersion: "settlement-outcome-v1",
      status: "verified",
      sourceRevision: 3,
      sourceChainHash: hash,
      settlementRevision: 1,
      outcomeHash: "b".repeat(64),
      ruleVersion: "clockwise-first-eligible-winner-left-of-button/v1",
      players: [
        { playerId: "A", potAward: 60_000, refund: 0, netDelta: 30_000 },
        { playerId: "B", potAward: 0, refund: 0, netDelta: -30_000 },
      ],
      pots: [{ potId: "main-0", kind: "main", amount: 60_000, winnerIds: ["A"], allocations: [{ potId: "main-0", winnerId: "A", amount: 60_000 }]}],
      refunds: [],
      handRanks: [],
    },
    ...overrides,
  };
}

describe("historical settlement display preview", () => {
  it("keeps CAS metadata out of the replay payload while preserving the verified display", () => {
    const parsed = parseHistoricalSettlementDisplayPreview(preview(), "historical-preview-key");
    expect(parsed).toMatchObject({ handId: "hand-4", sourceRevision: 3, outcomeHash: "b".repeat(64), idempotencyKey: "historical-preview-key" });
    expect(parsed?.settlement).not.toHaveProperty("sourceChainHash");
    expect(parsed?.settlement.pots[0].winnerIds).toEqual(["A"]);
  });

  it("fails closed for a malformed or privacy-violating preview", () => {
    expect(parseHistoricalSettlementDisplayPreview(preview({ source_chain_hash: "not-a-hash" }), "historical-preview-key")).toBeNull();
    const publicOutcome = preview().public_outcome as Record<string, unknown>;
    expect(parseHistoricalSettlementDisplayPreview(preview({
      public_outcome: { ...publicOutcome, privateEvidence: { holeCards: ["As", "Ah"] } },
    }), "historical-preview-key")).toBeNull();
  });
});
