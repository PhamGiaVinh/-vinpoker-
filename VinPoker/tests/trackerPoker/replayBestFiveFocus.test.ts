import { describe, expect, it } from "vitest";
import {
  normalizeReplayCardCode,
  resolveVerifiedBestFiveFocus,
} from "@/lib/tracker-poker/replayBestFiveFocus";
import type { ReplayFrame } from "@/lib/tracker-poker/replayEngine";
import type { ReplayPublicSettlement } from "@/lib/tracker-poker/replaySettlement";

const HAND_ID = "hand-1";

function settlement(overrides: Partial<ReplayPublicSettlement> = {}): ReplayPublicSettlement {
  return {
    schemaVersion: "settlement-outcome-v1",
    status: "verified",
    players: [
      { playerId: "tom", potAward: 20_000, refund: 0, netDelta: 10_000 },
      { playerId: "phil", potAward: 0, refund: 5_000, netDelta: -10_000 },
    ],
    pots: [{
      potId: "main-0",
      kind: "main",
      amount: 20_000,
      winnerIds: ["tom"],
      allocations: [{ potId: "main-0", winnerId: "tom", amount: 20_000 }],
    }],
    refunds: [{ playerId: "phil", amount: 5_000, sourceActionId: "uncalled-phil" }],
    handRanks: [{
      playerId: "tom",
      category: "quads",
      bestFive: ["Jd", "Jh", "Jc", "Js", "Ah"],
      kickers: ["A"],
    }],
    ...overrides,
  };
}

function frame(overrides: Partial<ReplayFrame> = {}): ReplayFrame {
  return {
    index: 2,
    seats: [
      {
        player_id: "tom",
        display_name: "Tom Dwan",
        seat_number: 1,
        chip_count: 20_000,
        is_active: true,
        table_id: "table-1",
        position: "BTN",
        hole_cards: ["Jd", "Jh"],
        pot_winner: true,
        payout_award: 20_000,
        refund_award: 0,
        hand_rank: { category: "quads", best_five: ["Jd", "Jh", "Jc", "Js", "Ah"], kickers: ["A"] },
      },
      {
        player_id: "phil",
        display_name: "Phil Ivey",
        seat_number: 2,
        chip_count: 0,
        is_active: true,
        table_id: "table-1",
        position: "BB",
        hole_cards: ["Qd", "As"],
        pot_winner: false,
        payout_award: 0,
        refund_award: 5_000,
      },
    ],
    displayCards: ["Kh", "Jc", "Qh", "Ah", "Js"],
    potSize: 20_000,
    potBreakdown: null,
    currentStreet: "showdown",
    lastActorId: "tom",
    latestAction: null,
    revealHoleCards: true,
    showdownResult: "winner",
    showdownWinnerIds: ["tom"],
    potAwards: [{ potIndex: 0, amount: 20_000, winnerPlayerIds: ["tom"] }],
    payoutVerified: true,
    ...overrides,
  };
}

function resolve(currentFrame = frame(), currentSettlement = settlement()) {
  return resolveVerifiedBestFiveFocus({
    handId: HAND_ID,
    frame: currentFrame,
    finalFrameIndex: 2,
    settlement: currentSettlement,
  });
}

describe("resolveVerifiedBestFiveFocus", () => {
  it("focuses the exact Hand #1 quads plus ace and nothing else", () => {
    const focus = resolve();
    expect(focus.enabled).toBe(true);
    expect([...focus.winnerPlayerIds]).toEqual(["tom"]);
    expect([...focus.boardCardCodes]).toEqual(expect.arrayContaining(["Jc", "Js", "Ah"]));
    expect([...focus.boardCardCodes]).not.toEqual(expect.arrayContaining(["Kh", "Qh"]));
    expect([...focus.holeCardCodesByPlayerId.get("tom") ?? []]).toEqual(expect.arrayContaining(["Jd", "Jh"]));
    expect(focus.boardCardCodes.size + (focus.holeCardCodesByPlayerId.get("tom")?.size ?? 0)).toBe(5);
  });

  it("normalizes ten and glyph suits to the canonical server card format", () => {
    expect(normalizeReplayCardCode("10\u2665")).toBe("Th");
    expect(normalizeReplayCardCode("jD")).toBe("Jd");
    expect(normalizeReplayCardCode("??")).toBeNull();
  });

  it("turns focus off before the final verified showdown frame", () => {
    expect(resolve(frame({ index: 1 })).enabled).toBe(false);
    expect(resolve(frame({ payoutVerified: false })).enabled).toBe(false);
    expect(resolve(frame({ revealHoleCards: false })).enabled).toBe(false);
    expect(resolve(frame({ showdownResult: "needs_resettle" })).enabled).toBe(false);
  });

  it("supports board-plays while leaving both winner hole cards outside best five", () => {
    const board = ["As", "Kd", "Qc", "Jh", "Ts"];
    const focus = resolve(
      frame({
        displayCards: board,
        seats: frame().seats.map((seat) => seat.player_id === "tom"
          ? { ...seat, hole_cards: ["2c", "3c"] }
          : { ...seat, hole_cards: ["4d", "5d"] }),
      }),
      settlement({
        handRanks: [{ playerId: "tom", category: "straight", bestFive: board, kickers: [] }],
      }),
    );
    expect(focus.enabled).toBe(true);
    expect(focus.boardCardCodes.size).toBe(5);
    expect(focus.holeCardCodesByPlayerId.get("tom")?.size).toBe(0);
  });

  it("supports a best five that uses exactly one winner hole card", () => {
    const focus = resolve(
      frame({
        displayCards: ["As", "Kd", "Qc", "Jh", "2s"],
        seats: frame().seats.map((seat) => seat.player_id === "tom"
          ? { ...seat, hole_cards: ["Ts", "3c"] }
          : { ...seat, hole_cards: ["4d", "5d"] }),
      }),
      settlement({
        handRanks: [{ playerId: "tom", category: "straight", bestFive: ["As", "Kd", "Qc", "Jh", "Ts"], kickers: [] }],
      }),
    );
    expect(focus.enabled).toBe(true);
    expect(focus.boardCardCodes.size).toBe(4);
    expect([...focus.holeCardCodesByPlayerId.get("tom") ?? []]).toEqual(["Ts"]);
  });

  it.each([
    ["four cards", ["Jd", "Jh", "Jc", "Js"]],
    ["six cards", ["Jd", "Jh", "Jc", "Js", "Ah", "Kh"]],
    ["duplicate", ["Jd", "Jd", "Jc", "Js", "Ah"]],
    ["outside the visible universe", ["Jd", "Jh", "Jc", "Js", "Ac"]],
  ])("fails the whole focus for malformed best five: %s", (_label, bestFive) => {
    expect(resolve(frame(), settlement({
      handRanks: [{ playerId: "tom", category: "quads", bestFive, kickers: ["A"] }],
    })).enabled).toBe(false);
  });

  it("fails all-or-nothing when one chop winner has malformed best five", () => {
    const currentFrame = frame({
      showdownResult: "chop",
      showdownWinnerIds: ["tom", "phil"],
      seats: frame().seats.map((seat) => ({
        ...seat,
        pot_winner: true,
        payout_award: 10_000,
      })),
    });
    const currentSettlement = settlement({
      players: [
        { playerId: "tom", potAward: 10_000, refund: 0, netDelta: 0 },
        { playerId: "phil", potAward: 10_000, refund: 5_000, netDelta: 0 },
      ],
      pots: [{
        potId: "main-0",
        kind: "main",
        amount: 20_000,
        winnerIds: ["tom", "phil"],
        allocations: [
          { potId: "main-0", winnerId: "tom", amount: 10_000 },
          { potId: "main-0", winnerId: "phil", amount: 10_000 },
        ],
      }],
      handRanks: [
        { playerId: "tom", category: "quads", bestFive: ["Jd", "Jh", "Jc", "Js", "Ah"], kickers: ["A"] },
        { playerId: "phil", category: "pair", bestFive: ["Qd", "Qd", "Kh", "Qh", "Ah"], kickers: [] },
      ],
    });
    expect(resolve(currentFrame, currentSettlement).enabled).toBe(false);
  });

  it("fails closed on duplicate visible cards across board and hole cards", () => {
    const duplicate = frame({
      seats: frame().seats.map((seat) => seat.player_id === "phil" ? { ...seat, hole_cards: ["Kh", "As"] } : seat),
    });
    expect(resolve(duplicate).enabled).toBe(false);
  });
});
