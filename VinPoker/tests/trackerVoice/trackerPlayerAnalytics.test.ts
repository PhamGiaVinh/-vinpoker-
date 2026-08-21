import { describe, expect, it } from "vitest";

import {
  classifyTrackerPlayerAnalytics,
  type TrackerAnalyticsHand,
} from "../../supabase/functions/_shared/trackerPlayerAnalytics";
import type { ActionRow, PlayerSeed } from "../../supabase/functions/_shared/trackerEngine/types";

const players: PlayerSeed[] = [
  { player_id: "A", seat_number: 1, starting_stack: 10_000 },
  { player_id: "B", seat_number: 2, starting_stack: 10_000 },
  { player_id: "C", seat_number: 3, starting_stack: 10_000 },
];

function action(
  player_id: string,
  action_type: ActionRow["action_type"],
  action_amount: number,
  action_order: number,
  street: ActionRow["street"] = "preflop",
): ActionRow {
  return { player_id, action_type, action_amount, action_order, street };
}

function hand(
  index: number,
  actions: ActionRow[],
  options: Partial<TrackerAnalyticsHand> = {},
): TrackerAnalyticsHand {
  return {
    handId: `hand-${index}`,
    status: "completed",
    isVoided: false,
    buttonSeat: 1,
    boardCardCount: 0,
    players,
    actions: [
      action("A", "post_sb", 50, 1),
      action("B", "post_bb", 100, 2),
      ...actions.map((item, offset) => ({ ...item, action_order: offset + 3 })),
    ],
    settlement: null,
    ...options,
  };
}

const proof = (winners: string[], eligible = ["A", "B"]): TrackerAnalyticsHand["settlement"] => ({
  verified: true,
  current: true,
  winnerPlayerIds: winners,
  eligiblePlayerIds: eligible,
  showdown: true,
});
describe("tracker player analytics V0", () => {
  it("classifies a 20-hand golden sample and excludes a voided hand", () => {
    const hands: TrackerAnalyticsHand[] = [];
    for (let index = 1; index <= 5; index += 1) {
      hands.push(hand(index, [action("A", "call", 50, 0), action("B", "check", 0, 0)], {
        boardCardCount: 5,
        settlement: proof(index % 2 ? ["A"] : ["B"]),
      }));
    }
    for (let index = 6; index <= 10; index += 1) {
      hands.push(hand(index, [action("A", "raise", 250, 0), action("B", "fold", 0, 0)], {
        boardCardCount: 3,
        settlement: proof(["A"], ["A"]),
      }));
    }
    for (let index = 11; index <= 15; index += 1) {
      hands.push(hand(index, [action("A", "fold", 0, 0)]));
    }
    // Short all-in opens below the full-raise increment: VPIP/PFR yes, no false 3-bet level.
    hands.push(hand(16, [action("C", "all_in", 80, 0), action("A", "call", 30, 0)]));
    // Multiway side-pot/chop proof is represented by unique winners and eligible players.
    hands.push(hand(17, [action("A", "raise", 250, 0), action("B", "call", 200, 0), action("C", "call", 250, 0)], {
      boardCardCount: 5,
      settlement: proof(["A", "C"], ["A", "B", "C"]),
    }));
    hands.push(hand(18, [action("A", "call", 50, 0)], { isVoided: true }));
    hands.push(hand(19, [action("A", "fold", 0, 0)]));
    // Corrected streams are consumed in their final canonical form, not from an old snapshot.
    hands.push(hand(20, [action("A", "call", 50, 0), action("B", "check", 0, 0)]));

    const result = classifyTrackerPlayerAnalytics("A", hands);
    expect(result.handsObserved).toBe(19);
    expect(result.metrics.vpip).toMatchObject({ numerator: 13, denominator: 19 });
    expect(result.metrics.pfr).toMatchObject({ numerator: 6, denominator: 19 });
    expect(result.metricVersion).toBe("tracker-player-analytics-v0");
  });

  it("does not treat a short all-in as a full raise that reopens betting", () => {
    const sample = hand(1, [
      action("C", "raise", 300, 0),
      action("B", "all_in", 350, 0),
      action("A", "call", 250, 0),
    ]);
    const result = classifyTrackerPlayerAnalytics("A", [sample]);
    expect(result.metrics.threeBet).toMatchObject({ numerator: 0, denominator: 1 });
    expect(result.metrics.fourBet.denominator).toBe(0);
  });

  it("fails W$SD and WWSF closed when verified current settlement proof is missing", () => {
    const sample = hand(1, [
      action("A", "call", 50, 0),
      action("B", "check", 0, 0),
      action("A", "check", 0, 0, "flop"),
      action("B", "check", 0, 0, "flop"),
    ], { boardCardCount: 5, settlement: null });
    const result = classifyTrackerPlayerAnalytics("A", [sample]);
    expect(result.unavailableMetrics).toEqual(expect.arrayContaining(["wsd", "wwsf"]));
    expect(result.metrics.wsd.percentage).toBeNull();
    expect(result.metrics.wwsf.percentage).toBeNull();
  });

  it("computes c-bet, fold-to-c-bet, check-raise and aggression frequency from committed actions", () => {
    const cbet = hand(1, [
      action("A", "raise", 250, 0),
      action("B", "call", 200, 0),
      action("A", "bet", 300, 0, "flop"),
      action("B", "fold", 0, 0, "flop"),
    ], { boardCardCount: 3, settlement: proof(["A"], ["A"]) });
    const checkRaise = hand(2, [
      action("A", "call", 50, 0),
      action("B", "check", 0, 0),
      action("A", "check", 0, 0, "flop"),
      action("B", "bet", 200, 0, "flop"),
      action("A", "raise", 600, 0, "flop"),
    ], { boardCardCount: 3, settlement: proof(["A"], ["A", "B"]) });
    const a = classifyTrackerPlayerAnalytics("A", [cbet, checkRaise]);
    const b = classifyTrackerPlayerAnalytics("B", [cbet]);
    expect(a.metrics.flopCbet).toMatchObject({ numerator: 1, denominator: 1 });
    expect(a.metrics.checkRaise).toMatchObject({ numerator: 1, denominator: 1 });
    expect(a.metrics.aggressionFrequency.numerator).toBeGreaterThan(0);
    expect(b.metrics.foldToCbet).toMatchObject({ numerator: 1, denominator: 1 });
  });
});
