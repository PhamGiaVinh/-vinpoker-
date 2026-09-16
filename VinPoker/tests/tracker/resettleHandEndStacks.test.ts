import { describe, expect, it } from "vitest";
import { resettleHandEndStacks } from "@/components/cashier/tournament-live/resettleApply";
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
});
