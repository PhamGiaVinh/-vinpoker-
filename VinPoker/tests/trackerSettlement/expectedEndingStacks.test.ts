import { describe, expect, it } from "vitest";
import {
  assertExpectedTargetEndingStacks,
  redactedTargetEndingStacks,
} from "@settlement/expectedEndingStacks.ts";

const targetPlayers = [
  { player_id: "p-1", entry_number: 1, starting_stack: 2_000 },
  { player_id: "p-2", entry_number: 1, starting_stack: 2_000 },
];

const outcome = {
  players: [
    { playerId: "p-1", endingStack: 3_500 },
    { playerId: "p-2", endingStack: 500 },
  ],
};

describe("atomic hand-correction ending stack proof", () => {
  it("requires every target player and every server ending stack to match", () => {
    const expected = [
      { player_id: "p-1", entry_number: 1, ending_stack: 3_500 },
      { player_id: "p-2", entry_number: 1, ending_stack: 500 },
    ];
    expect(() => assertExpectedTargetEndingStacks({ expected, targetPlayers, outcome })).not.toThrow();
    expect(redactedTargetEndingStacks({ targetPlayers, outcome })).toEqual(expected);
  });

  it("rejects a conserved but wrongly attributed stack split", () => {
    const expected = [
      { player_id: "p-1", entry_number: 1, ending_stack: 2_500 },
      { player_id: "p-2", entry_number: 1, ending_stack: 1_500 },
    ];
    expect(() => assertExpectedTargetEndingStacks({ expected, targetPlayers, outcome }))
      .toThrow("expected_target_stack_mismatch");
  });

  it("rejects a missing player even if the submitted total looks plausible", () => {
    const expected = [{ player_id: "p-1", entry_number: 1, ending_stack: 4_000 }];
    expect(() => assertExpectedTargetEndingStacks({ expected, targetPlayers, outcome }))
      .toThrow("expected_target_stack_identity_mismatch");
  });
});
