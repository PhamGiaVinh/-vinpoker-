import { describe, expect, it } from "vitest";

import { validateHandEditActions } from "@/components/cashier/tournament-live/handEditValidation";

const players = [
  { player_id: "p1", display_name: "Ghế 1", seat_number: 1, starting_stack: 1_000 },
  { player_id: "p2", display_name: "Ghế 2", seat_number: 2, starting_stack: 1_000 },
];

const legalActions = [
  { player_id: "p1", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 50, action_order: 1 },
  { player_id: "p2", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 100, action_order: 2 },
  { player_id: "p1", entry_number: 1, street: "preflop", action_type: "call", action_amount: 50, action_order: 3 },
  { player_id: "p2", entry_number: 1, street: "preflop", action_type: "check", action_amount: 0, action_order: 4 },
];

describe("completed-hand action advisory", () => {
  it("explains the exact call amount and accepts a legal canonical stream", () => {
    const result = validateHandEditActions(players, legalActions, 1);

    expect(result.ok).toBe(true);
    expect(result.potSize).toBe(200);
    expect(result.assessments[2]).toMatchObject({ legal: true, requiredAmount: 50, stackBefore: 950 });
  });

  it("blocks a call that does not match the server-derived amount", () => {
    const actions = legalActions.map((action) => action.action_order === 3 ? { ...action, action_amount: 25 } : action);
    const result = validateHandEditActions(players, actions, 1);

    expect(result.ok).toBe(false);
    expect(result.assessments[2]).toMatchObject({ legal: false, requiredAmount: 50 });
    expect(result.assessments[2].message).toContain("50");
  });

  it("blocks an under-minimum raise and an out-of-turn action", () => {
    const underRaise = [
      ...legalActions.slice(0, 2),
      { player_id: "p1", entry_number: 1, street: "preflop", action_type: "raise", action_amount: 125, action_order: 3 },
    ];
    const outOfTurn = [
      ...legalActions.slice(0, 2),
      { player_id: "p2", entry_number: 1, street: "preflop", action_type: "check", action_amount: 0, action_order: 3 },
    ];

    expect(validateHandEditActions(players, underRaise, 1).assessments[2]).toMatchObject({ legal: false, minimumAmount: 150 });
    expect(validateHandEditActions(players, outOfTurn, 1).assessments[2].message).toContain("Sai thứ tự lượt");
  });
});
