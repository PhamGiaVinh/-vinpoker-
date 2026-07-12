import { describe, expect, it } from "vitest";
import {
  ODD_CHIP_RULE_V1,
  SETTLEMENT_SCHEMA_V1,
  SettlementContractErrorV1,
  allocateManualSinglePotV1,
  canonicalJsonV1,
  computeOutcomeHashV1,
  computeSourceChainHashV1,
  projectPublicSettlementV1,
  validatePublicSettlementOutcomeV1,
  validateSettlementOutcomeV1,
  verifyOutcomeHashV1,
  type PrivateSettlementOutcomeV1,
  type PublicSettlementOutcomeV1,
} from "@settlement/outcomeV1.ts";

const ZERO_HASH = "0".repeat(64);

function hand8Draft(): PrivateSettlementOutcomeV1 {
  return {
    schemaVersion: SETTLEMENT_SCHEMA_V1,
    status: "verified",
    sourceRevision: 8,
    sourceChainHash: ZERO_HASH,
    settlementRevision: 1,
    outcomeHash: ZERO_HASH,
    ruleVersion: ODD_CHIP_RULE_V1,
    players: [
      {
        playerId: "limitless",
        startingStack: 8_700_000,
        committedTotal: 8_700_000,
        potAward: 8_700_000,
        refund: 0,
        creditedTotal: 8_700_000,
        netDelta: 0,
        externalDelta: 0,
        endingStack: 8_700_000,
      },
      {
        playerId: "kayhan",
        startingStack: 47_400_000,
        committedTotal: 47_400_000,
        potAward: 8_700_000,
        refund: 38_700_000,
        creditedTotal: 47_400_000,
        netDelta: 0,
        externalDelta: 0,
        endingStack: 47_400_000,
      },
    ],
    pots: [
      {
        potId: "main-0",
        kind: "main",
        amount: 17_400_000,
        eligiblePlayerIds: ["limitless", "kayhan"],
        winnerIds: ["limitless", "kayhan"],
        allocations: [
          { potId: "main-0", winnerId: "limitless", amount: 8_700_000, includesOddChip: false },
          { potId: "main-0", winnerId: "kayhan", amount: 8_700_000, includesOddChip: false },
        ],
      },
    ],
    refunds: [
      { playerId: "kayhan", amount: 38_700_000, sourceActionId: "h8-a2" },
    ],
    handRanks: [
      {
        playerId: "limitless",
        category: "three_of_a_kind",
        bestFive: ["Jh", "Jd", "Jc", "As", "Qh"],
        kickers: ["A", "Q"],
        isPublic: true,
        holeCards: ["Jc", "9d"],
        evaluatorInput: { source: "private-showdown" },
      },
      {
        playerId: "kayhan",
        category: "three_of_a_kind",
        bestFive: ["Jh", "Jd", "Js", "As", "Qh"],
        kickers: ["A", "Q"],
        isPublic: true,
        holeCards: ["Js", "Ts"],
      },
    ],
    totals: {
      startingStack: 56_100_000,
      committedTotal: 56_100_000,
      distributablePot: 17_400_000,
      refundTotal: 38_700_000,
      potAward: 17_400_000,
      creditedTotal: 56_100_000,
      netDelta: 0,
      externalDelta: 0,
      endingStack: 56_100_000,
    },
    privateEvidence: {
      targetHandId: "hand-8",
      buttonSeat: 1,
      communityCards: ["As", "Jd", "Qh", "Jh", "8h"],
      seats: [
        { seatNumber: 1, playerId: "limitless", startingStack: 8_700_000 },
        { seatNumber: 2, playerId: "kayhan", startingStack: 47_400_000 },
      ],
      actions: [
        { actionId: "h8-a1", actionOrder: 1, playerId: "limitless", street: "preflop", actionType: "post_bb", amount: 200_000 },
        { actionId: "h8-a2", actionOrder: 2, playerId: "kayhan", street: "preflop", actionType: "all_in", amount: 47_400_000 },
        { actionId: "h8-a3", actionOrder: 3, playerId: "limitless", street: "preflop", actionType: "call", amount: 8_500_000 },
      ],
      sourceChain: [
        { handId: "hand-8", handNumber: 8, sourceRevision: 8, sourceHash: "1".repeat(64) },
        { handId: "hand-9", handNumber: 9, sourceRevision: 2, sourceHash: "2".repeat(64) },
      ],
      externalAdjustments: [],
      holeCardsByPlayer: {
        limitless: ["Jc", "9d"],
        kayhan: ["Js", "Ts"],
      },
      muckedHoleCardsByPlayer: {},
      evaluatorInput: { privateCards: ["2c", "3d"] },
      correctionNotes: "owner-only repair note",
      actor: { userId: "staff-secret-id", role: "owner" },
    },
  };
}

async function signedHand8(): Promise<PrivateSettlementOutcomeV1> {
  const outcome = hand8Draft();
  outcome.sourceChainHash = await computeSourceChainHashV1(outcome.privateEvidence);
  outcome.outcomeHash = await computeOutcomeHashV1(outcome);
  return outcome;
}

function multiSidePotOutcome(): PublicSettlementOutcomeV1 {
  return {
    schemaVersion: SETTLEMENT_SCHEMA_V1,
    status: "verified",
    sourceRevision: 4,
    sourceChainHash: ZERO_HASH,
    settlementRevision: 1,
    outcomeHash: ZERO_HASH,
    ruleVersion: ODD_CHIP_RULE_V1,
    players: [
      { playerId: "A", startingStack: 100, committedTotal: 100, potAward: 150, refund: 0, creditedTotal: 150, netDelta: 50, externalDelta: 0, endingStack: 150 },
      { playerId: "B", startingStack: 200, committedTotal: 200, potAward: 150, refund: 0, creditedTotal: 150, netDelta: -50, externalDelta: 0, endingStack: 150 },
      { playerId: "C", startingStack: 200, committedTotal: 200, potAward: 100, refund: 100, creditedTotal: 200, netDelta: 0, externalDelta: 0, endingStack: 200 },
    ],
    pots: [
      {
        potId: "main-0",
        kind: "main",
        amount: 300,
        eligiblePlayerIds: ["A", "B", "C"],
        winnerIds: ["A", "B"],
        allocations: [
          { potId: "main-0", winnerId: "A", amount: 150, includesOddChip: false },
          { potId: "main-0", winnerId: "B", amount: 150, includesOddChip: false },
        ],
      },
      {
        potId: "side-1",
        kind: "side",
        amount: 100,
        eligiblePlayerIds: ["B", "C"],
        winnerIds: ["C"],
        allocations: [{ potId: "side-1", winnerId: "C", amount: 100, includesOddChip: false }],
      },
    ],
    refunds: [{ playerId: "C", amount: 100, sourceActionId: "c-refund" }],
    handRanks: [],
    totals: {
      startingStack: 500,
      committedTotal: 500,
      distributablePot: 400,
      refundTotal: 100,
      potAward: 400,
      creditedTotal: 500,
      netDelta: 0,
      externalDelta: 0,
      endingStack: 500,
    },
  };
}

describe("SettlementOutcomeV1 accounting", () => {
  it("locks the Hand #8 chop, refund and ending-stack formulas", async () => {
    const outcome = await signedHand8();
    expect(validateSettlementOutcomeV1(outcome)).toEqual({ ok: true, issues: [] });
    expect(await verifyOutcomeHashV1(outcome)).toBe(true);

    expect(outcome.totals.committedTotal).toBe(56_100_000);
    expect(outcome.totals.distributablePot).toBe(17_400_000);
    expect(outcome.pots[0].allocations.map((allocation) => allocation.amount)).toEqual([8_700_000, 8_700_000]);
    expect(outcome.refunds).toEqual([{ playerId: "kayhan", amount: 38_700_000, sourceActionId: "h8-a2" }]);
    expect(outcome.players.map((player) => player.endingStack)).toEqual([8_700_000, 47_400_000]);
    expect(outcome.handRanks.map((rank) => [rank.category, ...rank.kickers])).toEqual([
      ["three_of_a_kind", "A", "Q"],
      ["three_of_a_kind", "A", "Q"],
    ]);
  });

  it("rejects credited, net and ending formula drift", async () => {
    const outcome = await signedHand8();
    outcome.players = outcome.players.map((player, index) =>
      index === 0 ? { ...player, creditedTotal: 9_000_000, netDelta: 300_000, endingStack: 9_000_000 } : player
    );
    const result = validateSettlementOutcomeV1(outcome);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("PLAYER_CREDIT_FORMULA");
      expect(result.issues.map((issue) => issue.code)).toContain("TOTAL_MISMATCH");
      expect(result.issues.map((issue) => issue.code)).toContain("STACK_CONSERVATION");
    }
  });

  it("rejects refund-as-pot-award and whole-hand conservation drift", async () => {
    const outcome = await signedHand8();
    outcome.players = outcome.players.map((player, index) => index === 1
      ? {
          ...player,
          potAward: 47_400_000,
          refund: 0,
          creditedTotal: 47_400_000,
        }
      : player);
    const result = validateSettlementOutcomeV1(outcome);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("PLAYER_POT_AWARD_MISMATCH");
      expect(result.issues.map((issue) => issue.code)).toContain("PLAYER_REFUND_MISMATCH");
    }
  });

  it("rejects malformed source ordering and a refund without its source action", async () => {
    const outcome = await signedHand8();
    outcome.privateEvidence = {
      ...outcome.privateEvidence,
      actions: outcome.privateEvidence.actions.map((action, index) => ({
        ...action,
        actionOrder: index === 2 ? 1 : action.actionOrder,
      })).filter((action) => action.actionId !== "h8-a2"),
    };
    const result = validateSettlementOutcomeV1(outcome);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("DUPLICATE_ID");
      expect(result.issues.map((issue) => issue.code)).toContain("REFUND_ACTION_NOT_FOUND");
    }
  });

  it("requires every non-zero external delta to have a verified source", async () => {
    const outcome = await signedHand8();
    outcome.players = outcome.players.map((player, index) => index === 0
      ? { ...player, externalDelta: 100, endingStack: player.endingStack + 100 }
      : player);
    outcome.totals = {
      ...outcome.totals,
      externalDelta: 100,
      endingStack: outcome.totals.endingStack + 100,
    };
    const result = validateSettlementOutcomeV1(outcome);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("EXTERNAL_DELTA_SOURCE_MISMATCH");
  });

  it("rejects duplicate player and pot identifiers", async () => {
    const duplicatePlayers = await signedHand8();
    duplicatePlayers.players = [...duplicatePlayers.players, { ...duplicatePlayers.players[0] }];
    const playerResult = validateSettlementOutcomeV1(duplicatePlayers);
    expect(playerResult.ok).toBe(false);
    if (!playerResult.ok) expect(playerResult.issues.map((issue) => issue.code)).toContain("DUPLICATE_ID");

    const duplicatePots = await signedHand8();
    duplicatePots.pots = [...duplicatePots.pots, { ...duplicatePots.pots[0] }];
    const potResult = validateSettlementOutcomeV1(duplicatePots);
    expect(potResult.ok).toBe(false);
    if (!potResult.ok) expect(potResult.issues.map((issue) => issue.code)).toContain("DUPLICATE_ID");
  });

  it("rejects integer sums above Number.MAX_SAFE_INTEGER", async () => {
    const outcome = await signedHand8();
    const max = Number.MAX_SAFE_INTEGER;
    outcome.players = outcome.players.map((player) => ({
      ...player,
      startingStack: max,
      endingStack: max,
      committedTotal: 0,
      potAward: 0,
      refund: 0,
      creditedTotal: 0,
      netDelta: 0,
    }));
    const result = validateSettlementOutcomeV1(outcome);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("INTEGER_SUM_OVERFLOW");
  });

  it("validates a main pot plus side-pot allocation and separate refund", () => {
    expect(validateSettlementOutcomeV1(multiSidePotOutcome())).toEqual({ ok: true, issues: [] });
  });
});

describe("private/public boundary and canonical hashing", () => {
  it("projects only public ranks and strips every private evidence field", async () => {
    const outcome = await signedHand8();
    outcome.handRanks = outcome.handRanks.map((rank, index) => index === 1 ? { ...rank, isPublic: false } : rank);
    const projected = projectPublicSettlementV1(outcome);
    const serialized = JSON.stringify({ ...projected, sourceChainHash: "", outcomeHash: "" });

    expect(projected.handRanks.map((rank) => rank.playerId)).toEqual(["limitless"]);
    expect(validatePublicSettlementOutcomeV1(projected)).toEqual({ ok: true, issues: [] });
    expect(Object.keys(projected)).not.toContain("privateEvidence");
    expect(Object.keys(projected.handRanks[0])).toEqual(["playerId", "category", "bestFive", "kickers"]);
    expect(serialized).not.toContain("2c");
    expect(serialized).not.toContain("owner-only repair note");
    expect(serialized).not.toContain("staff-secret-id");
  });

  it("rejects a public payload that smuggles private cards", async () => {
    const projected = projectPublicSettlementV1(await signedHand8());
    const malicious = {
      ...projected,
      handRanks: projected.handRanks.map((rank, index) => index === 0 ? { ...rank, holeCards: ["2c", "3d"] } : rank),
    };
    const result = validatePublicSettlementOutcomeV1(malicious);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("FORBIDDEN_PUBLIC_FIELD");
  });

  it("rejects private fields nested below an otherwise public field", async () => {
    const projected = projectPublicSettlementV1(await signedHand8());
    const malicious = { ...projected, metadata: { nested: { evaluatorInput: { cards: ["2c", "3d"] } } } };
    const result = validatePublicSettlementOutcomeV1(malicious);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("FORBIDDEN_PUBLIC_FIELD");
  });

  it("normalizes player, pot, allocation, seat and action ordering", async () => {
    const outcome = await signedHand8();
    const reordered: PrivateSettlementOutcomeV1 = {
      ...outcome,
      players: [...outcome.players].reverse(),
      pots: outcome.pots.map((pot) => ({
        ...pot,
        eligiblePlayerIds: [...pot.eligiblePlayerIds].reverse(),
        winnerIds: [...pot.winnerIds].reverse(),
        allocations: [...pot.allocations].reverse(),
      })),
      handRanks: [...outcome.handRanks].reverse(),
      privateEvidence: {
        ...outcome.privateEvidence,
        seats: [...outcome.privateEvidence.seats].reverse(),
        actions: [...outcome.privateEvidence.actions].reverse(),
        sourceChain: [...outcome.privateEvidence.sourceChain].reverse(),
        externalAdjustments: [...outcome.privateEvidence.externalAdjustments].reverse(),
      },
    };

    expect(await computeSourceChainHashV1(reordered.privateEvidence)).toBe(outcome.sourceChainHash);
    expect(await computeOutcomeHashV1(reordered)).toBe(outcome.outcomeHash);
  });

  it("changes the source-chain hash when a later hand anchor changes", async () => {
    const outcome = await signedHand8();
    const changedEvidence = {
      ...outcome.privateEvidence,
      sourceChain: outcome.privateEvidence.sourceChain.map((anchor) => anchor.handId === "hand-9"
        ? { ...anchor, sourceHash: "3".repeat(64) }
        : anchor),
    };
    expect(await computeSourceChainHashV1(changedEvidence)).not.toBe(outcome.sourceChainHash);

    const duplicateHandNumber = await signedHand8();
    duplicateHandNumber.privateEvidence = {
      ...duplicateHandNumber.privateEvidence,
      sourceChain: duplicateHandNumber.privateEvidence.sourceChain.map((anchor) =>
        anchor.handId === "hand-9" ? { ...anchor, handNumber: 8 } : anchor
      ),
    };
    const result = validateSettlementOutcomeV1(duplicateHandNumber);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("DUPLICATE_ID");
  });

  it("canonical JSON sorts keys and rejects non-integer numeric values", () => {
    expect(canonicalJsonV1({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(() => canonicalJsonV1({ chips: 1.5 })).toThrow(SettlementContractErrorV1);
  });
});

describe("manual winner intent", () => {
  const input = {
    potId: "main-0",
    kind: "main" as const,
    amount: 5,
    eligiblePlayerIds: ["A", "B", "C"],
    refunds: [],
    clockwisePlayerIdsLeftOfButton: ["B", "C", "A"],
    hasMissingActions: false,
    hasMalformedStack: false,
    intent: { winnerIds: ["A", "C"] },
  };

  it("allocates the odd chip to the first winning seat left of the button", () => {
    expect(allocateManualSinglePotV1(input)).toEqual([
      { potId: "main-0", winnerId: "C", amount: 3, includesOddChip: true },
      { potId: "main-0", winnerId: "A", amount: 2, includesOddChip: false },
    ]);
  });

  it("wraps odd-chip order from the end of the clockwise seat list", () => {
    expect(allocateManualSinglePotV1({ ...input, clockwisePlayerIdsLeftOfButton: ["C", "A", "B"] })).toEqual([
      { potId: "main-0", winnerId: "C", amount: 3, includesOddChip: true },
      { potId: "main-0", winnerId: "A", amount: 2, includesOddChip: false },
    ]);
  });

  it("rejects side pots, refunds, incomplete chains and ineligible winners", () => {
    expect(() => allocateManualSinglePotV1({ ...input, kind: "side" })).toThrow(/side pots/);
    expect(() => allocateManualSinglePotV1({ ...input, refunds: [{ playerId: "A", amount: 1, sourceActionId: "a1" }] })).toThrow(/refund/);
    expect(() => allocateManualSinglePotV1({ ...input, hasMissingActions: true })).toThrow(/complete action/);
    expect(() => allocateManualSinglePotV1({ ...input, intent: { winnerIds: ["D"] } })).toThrow(/not eligible/);
  });
});
