import { describe, expect, it } from "vitest";
import {
  formatVerifiedHandRanking,
  normalizeReplayCardCode,
  resolveVerifiedBestFiveFocus,
  resolveVerifiedShowdownPresentation,
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

function presentation(currentFrame = frame(), currentSettlement = settlement(), locale = "vi") {
  return resolveVerifiedShowdownPresentation({
    handId: HAND_ID,
    frame: currentFrame,
    finalFrameIndex: 2,
    settlement: currentSettlement,
    locale,
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

  it("uses the same verified Hand #1 winner and detailed ranking in the shared presentation", () => {
    const result = presentation();
    expect(result.enabled).toBe(true);
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0]).toMatchObject({
      playerId: "tom",
      playerName: "Tom Dwan",
      seatNumber: 1,
      rankingText: "Tứ quý J · Kicker A",
    });
    expect(result.focus).toEqual(resolve());
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
          ? {
              ...seat,
              hole_cards: ["2c", "3c"],
              hand_rank: { category: "straight", best_five: board, kickers: [] },
            }
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
          ? {
              ...seat,
              hole_cards: ["Ts", "3c"],
              hand_rank: { category: "straight", best_five: ["As", "Kd", "Qc", "Jh", "Ts"], kickers: [] },
            }
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

  it("deduplicates a multi-pot winner and excludes a refund-only player", () => {
    const result = presentation(
      frame(),
      settlement({
        pots: [
          {
            potId: "main-0",
            kind: "main",
            amount: 10_000,
            winnerIds: ["tom"],
            allocations: [{ potId: "main-0", winnerId: "tom", amount: 10_000 }],
          },
          {
            potId: "side-1",
            kind: "side",
            amount: 10_000,
            winnerIds: ["tom"],
            allocations: [{ potId: "side-1", winnerId: "tom", amount: 10_000 }],
          },
        ],
      }),
    );
    expect(result.enabled).toBe(true);
    expect(result.winners.map((winner) => winner.playerId)).toEqual(["tom"]);
    expect(result.focus.winnerPlayerIds.has("phil")).toBe(false);
  });

  it("keeps a player with both a pot award and refund in the verified winner set", () => {
    const result = presentation(
      frame({
        seats: frame().seats.map((seat) => seat.player_id === "tom"
          ? { ...seat, refund_award: 5_000 }
          : { ...seat, refund_award: 0 }),
      }),
      settlement({
        players: [
          { playerId: "tom", potAward: 20_000, refund: 5_000, netDelta: 15_000 },
          { playerId: "phil", potAward: 0, refund: 0, netDelta: -10_000 },
        ],
        refunds: [{ playerId: "tom", amount: 5_000, sourceActionId: "uncalled-tom" }],
      }),
    );
    expect(result.enabled).toBe(true);
    expect(result.winners.map((winner) => winner.playerId)).toEqual(["tom"]);
  });

  it("fails closed on duplicate visible cards across board and hole cards", () => {
    const duplicate = frame({
      seats: frame().seats.map((seat) => seat.player_id === "phil" ? { ...seat, hole_cards: ["Kh", "As"] } : seat),
    });
    expect(resolve(duplicate).enabled).toBe(false);
  });
});

describe("formatVerifiedHandRanking", () => {
  it.each([
    ["quads", ["Jd", "Jh", "Jc", "Js", "Ah"], ["A"], "Tứ quý J · Kicker A", "Four Jacks · Ace kicker"],
    ["fullhouse", ["Jd", "Jh", "Jc", "Ah", "As"], ["A"], "Cù lũ J và A", "Jacks full of Aces"],
    ["two_pair", ["Jd", "Jh", "7c", "7s", "Ah"], ["A"], "Hai đôi J và 7 · Kicker A", "Jacks and Sevens · Ace kicker"],
    ["trips", ["Jd", "Jh", "Jc", "Ah", "Ks"], ["A", "K"], "Bộ ba J · Kicker A-K", "Three Jacks · A-K kickers"],
    ["pair", ["Jd", "Jh", "Ah", "Ks", "Qc"], ["A", "K", "Q"], "Một đôi J · Kicker A-K-Q", "Pair of Jacks · A-K-Q kickers"],
    ["straight", ["As", "Kd", "Qc", "Jh", "Ts"], [], "Sảnh đến A", "Ace-high Straight"],
    ["straight", ["As", "2d", "3c", "4h", "5s"], [], "Sảnh đến 5", "Five-high Straight"],
    ["flush", ["Ah", "Jh", "8h", "5h", "2h"], ["J", "8", "5", "2"], "Thùng A cao", "Ace-high Flush"],
    ["high_card", ["As", "Kd", "Qc", "9h", "7s"], ["K", "Q", "9", "7"], "Bài cao A · K-Q-9-7", "Ace high · K-Q-9-7"],
    ["straight_flush", ["9h", "8h", "7h", "6h", "5h"], [], "Thùng phá sảnh đến 9", "Nine-high Straight Flush"],
    ["royal_flush", ["Ah", "Kh", "Qh", "Jh", "Th"], [], "Thùng phá sảnh Royal", "Royal Flush"],
  ])("formats verified %s in Vietnamese and English", (category, bestFive, kickers, vietnamese, english) => {
    expect(formatVerifiedHandRanking({ category, bestFive, kickers, locale: "vi" })).toBe(vietnamese);
    expect(formatVerifiedHandRanking({ category, bestFive, kickers, locale: "en" })).toBe(english);
  });

  it.each([
    ["unknown category", "banana", ["As", "Kd", "Qc", "Jh", "Ts"], []],
    ["four cards", "straight", ["As", "Kd", "Qc", "Jh"], []],
    ["six cards", "straight", ["As", "Kd", "Qc", "Jh", "Ts", "9d"], []],
    ["duplicate card", "pair", ["Jd", "Jd", "Ah", "Ks", "Qc"], ["A", "K", "Q"]],
    ["bad kicker", "quads", ["Jd", "Jh", "Jc", "Js", "Ah"], ["K"]],
  ])("fails closed for %s", (_label, category, bestFive, kickers) => {
    expect(formatVerifiedHandRanking({ category, bestFive, kickers, locale: "vi" })).toBeNull();
  });
});
