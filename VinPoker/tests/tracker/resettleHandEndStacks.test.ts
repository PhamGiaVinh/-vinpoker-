import { describe, expect, it } from "vitest";
import { checkExpectedHandEndStacks, resettleHandEndStacks } from "@/components/cashier/tournament-live/resettleApply";
import type { ResettleOk } from "@/lib/tracker-poker/resettleForward";

const result: ResettleOk = {
  ok: true,
  safeToWrite: true,
  targetWinnerIds: ["seat-2"],
  changes: [
    {
      hand_id: "hand-12",
      hand_number: 12,
      player_id: "seat-1",
      before_ending: 1_400,
      after_ending: 900,
      before_starting: 2_000,
      after_starting: 2_000,
    },
    {
      hand_id: "hand-12",
      hand_number: 12,
      player_id: "seat-2",
      before_ending: 600,
      after_ending: 1_100,
      before_starting: 2_000,
      after_starting: 2_000,
    },
    {
      hand_id: "hand-13",
      hand_number: 13,
      player_id: "seat-1",
      before_ending: 900,
      after_ending: 800,
      before_starting: 900,
      after_starting: 900,
    },
  ],
  finalStacks: [
    { player_id: "seat-1", chip_count: 800 },
    { player_id: "seat-2", chip_count: 1_100 },
  ],
  changedPlayerIds: ["seat-1", "seat-2"],
  summary: "test",
};

describe("resettleHandEndStacks", () => {
  it("shows the edited hand only and retains chip conservation", () => {
    expect(
      resettleHandEndStacks(result, "hand-12", [
        { player_id: "seat-1", ending_stack: 1_400 },
        { player_id: "seat-2", ending_stack: 600 },
      ]),
    ).toEqual({
      rows: [
        { player_id: "seat-1", before: 1_400, after: 900 },
        { player_id: "seat-2", before: 600, after: 1_100 },
      ],
      beforeTotal: 2_000,
      afterTotal: 2_000,
      conserved: true,
    });
  });

  it("blocks a conserved observed stack split until the replay matches every seat", () => {
    const preview = resettleHandEndStacks(result, "hand-12", [
      { player_id: "seat-1", ending_stack: 1_400 },
      { player_id: "seat-2", ending_stack: 600 },
    ]);

    expect(checkExpectedHandEndStacks(preview, [
      { player_id: "seat-1", entry_number: 1, ending_stack: 800 },
      { player_id: "seat-2", entry_number: 1, ending_stack: 1_200 },
    ])).toMatchObject({
      expectedTotal: 2_000,
      expectedConserved: true,
      matchesEngine: false,
      rows: [
        { player_id: "seat-1", expected: 800, after: 900, matches: false },
        { player_id: "seat-2", expected: 1_200, after: 1_100, matches: false },
      ],
    });
  });

  it("accepts observed stacks only when the replay reaches the same split", () => {
    const preview = resettleHandEndStacks(result, "hand-12", [
      { player_id: "seat-1", ending_stack: 1_400 },
      { player_id: "seat-2", ending_stack: 600 },
    ]);

    expect(checkExpectedHandEndStacks(preview, [
      { player_id: "seat-1", entry_number: 1, ending_stack: 900 },
      { player_id: "seat-2", entry_number: 1, ending_stack: 1_100 },
    ])).toMatchObject({
      expectedTotal: 2_000,
      expectedConserved: true,
      matchesEngine: true,
    });
  });
});
