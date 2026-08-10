import { describe, expect, it } from "vitest";
import { parseReplayPublicSettlement } from "@/lib/tracker-poker/replaySettlement";

const verifiedChop = () => ({
  schemaVersion: "settlement-outcome-v1",
  status: "verified",
  players: [
    {
      playerId: "A",
      startingStack: 1_000,
      committedTotal: 1_000,
      potAward: 1_000,
      refund: 0,
      creditedTotal: 1_000,
      netDelta: 0,
      externalDelta: 0,
      endingStack: 1_000,
    },
    {
      playerId: "B",
      startingStack: 1_500,
      committedTotal: 1_500,
      potAward: 1_000,
      refund: 500,
      creditedTotal: 1_500,
      netDelta: 0,
      externalDelta: 0,
      endingStack: 1_500,
    },
  ],
  pots: [
    {
      potId: "main-0",
      kind: "main",
      amount: 2_000,
      eligiblePlayerIds: ["A", "B"],
      winnerIds: ["A", "B"],
      allocations: [
        { potId: "main-0", winnerId: "A", amount: 1_000, includesOddChip: false },
        { potId: "main-0", winnerId: "B", amount: 1_000, includesOddChip: false },
      ],
    },
  ],
  refunds: [{ playerId: "B", amount: 500, sourceActionId: "a2" }],
  handRanks: [
    { playerId: "A", category: "straight", bestFive: ["As", "Kd", "Qc", "Jh", "Ts"], kickers: [] },
    { playerId: "B", category: "straight", bestFive: ["As", "Kd", "Qc", "Jh", "Ts"], kickers: [] },
  ],
  totals: {
    startingStack: 2_500,
    committedTotal: 2_500,
    distributablePot: 2_000,
    refundTotal: 500,
    potAward: 2_000,
    creditedTotal: 2_500,
    netDelta: 0,
    externalDelta: 0,
    endingStack: 2_500,
  },
});

describe("parseReplayPublicSettlement", () => {
  it("accepts the RPC public projection without hashes or private evidence", () => {
    const parsed = parseReplayPublicSettlement(verifiedChop());
    expect(parsed?.players.map((player) => [player.playerId, player.potAward, player.refund])).toEqual([
      ["A", 1_000, 0],
      ["B", 1_000, 500],
    ]);
    expect(parsed?.handRanks[0].bestFive).toEqual(["As", "Kd", "Qc", "Jh", "Ts"]);
  });

  it("fails closed for empty, unverified, malformed or private payloads", () => {
    expect(parseReplayPublicSettlement({})).toBeNull();
    expect(parseReplayPublicSettlement({ ...verifiedChop(), status: "needs_resettle" })).toBeNull();
    expect(parseReplayPublicSettlement({ ...verifiedChop(), privateEvidence: { holeCardsByPlayer: {} } })).toBeNull();

    const conflicting = verifiedChop();
    conflicting.players[0].potAward = 2_000;
    expect(parseReplayPublicSettlement(conflicting)).toBeNull();
  });

  it("rejects missing or duplicate main pots and unsafe aggregate chip totals", () => {
    const noMain = verifiedChop();
    noMain.pots[0].kind = "side";
    expect(parseReplayPublicSettlement(noMain)).toBeNull();

    const duplicateMain = verifiedChop();
    duplicateMain.pots.push({ ...duplicateMain.pots[0], potId: "main-1" });
    duplicateMain.pots[1].allocations = duplicateMain.pots[1].allocations.map((allocation) => ({
      ...allocation,
      potId: "main-1",
    }));
    duplicateMain.players[0].potAward = 2_000;
    duplicateMain.players[1].potAward = 2_000;
    expect(parseReplayPublicSettlement(duplicateMain)).toBeNull();

    const overflow = verifiedChop();
    overflow.pots.push({
      ...overflow.pots[0],
      potId: "side-1",
      kind: "side",
      amount: Number.MAX_SAFE_INTEGER,
      allocations: [{ potId: "side-1", winnerId: "A", amount: Number.MAX_SAFE_INTEGER, includesOddChip: false }],
      winnerIds: ["A"],
    });
    expect(parseReplayPublicSettlement(overflow)).toBeNull();
  });
});
