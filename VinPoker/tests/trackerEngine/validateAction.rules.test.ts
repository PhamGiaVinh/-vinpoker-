// Rules-pin (PR-T): validateAction — min-raise, BB option, street reset, and the
// PROOF that the UAT errors were a SEED bug (with correct seeds the same actions
// are legal), including the short-all-in no-reopen rule.
// Pure; no DB, no source change.
import { describe, it, expect } from "vitest";
import { reduceHand } from "@tracker-engine/handState.ts";
import { validateAction } from "@tracker-engine/validateAction.ts";
import type { ActionRow, PlayerSeed } from "@tracker-engine/types.ts";

const THREE: PlayerSeed[] = [
  { player_id: "P1", seat_number: 1, starting_stack: 10000 },
  { player_id: "P2", seat_number: 2, starting_stack: 10000 },
  { player_id: "P3", seat_number: 3, starting_stack: 10000 },
];
const HU: PlayerSeed[] = [
  { player_id: "P1", seat_number: 1, starting_stack: 10000 },
  { player_id: "P2", seat_number: 2, starting_stack: 10000 },
];
const BUTTON = 1;

function build(rows: [string, ActionRow["action_type"], number, ActionRow["street"]?][]): ActionRow[] {
  return rows.map(([player_id, action_type, action_amount, street], i) => ({
    player_id,
    action_type,
    action_amount,
    street: street ?? "preflop",
    action_order: i + 1,
  }));
}
const propose = (
  player_id: string,
  action_type: ActionRow["action_type"],
  action_amount: number,
  street: ActionRow["street"] = "preflop",
  action_order = 99,
) => ({ player_id, street, action_type, action_amount, action_order });

describe("validateAction — UAT errors are a SEED bug, NOT a rules bug (correct seeds → legal)", () => {
  it("3-handed: with real stacks, UTG RAISE over the BB is legal (no RAISE_WITHOUT_BET)", () => {
    const prior = build([["P2", "post_sb", 50], ["P3", "post_bb", 100]]);
    const r = validateAction(THREE, prior, BUTTON, propose("P1", "raise", 200));
    expect(r.valid).toBe(true);
    expect(r.code).toBe("OK");
  });

  it("heads-up: with real stacks, the SB CALL is legal (no PLAYER_ALL_IN)", () => {
    const prior = build([["P1", "post_sb", 50], ["P2", "post_bb", 100]]);
    const r = validateAction(HU, prior, BUTTON, propose("P1", "call", 50));
    expect(r.valid).toBe(true);
    expect(r.normalizedAmount).toBe(50); // owed 100 − posted 50
  });
});

describe("validateAction — min-raise increment", () => {
  it("allows bet 100, raise-to 200, then raise-to 300", () => {
    const prior = build([
      ["P1", "bet", 100, "flop"],
      ["P2", "raise", 200, "flop"],
    ]);

    expect(validateAction(THREE, prior, BUTTON, propose("P3", "raise", 299, "flop")).code).toBe("BELOW_MIN_RAISE");
    expect(validateAction(THREE, prior, BUTTON, propose("P3", "raise", 300, "flop")).valid).toBe(true);
  });

  it("a re-raise below the last full increment is BELOW_MIN_RAISE; a full one is legal", () => {
    // SB 50 / BB 100, then P1 raises TO 300 (highestBet 300, minRaise increment 200).
    const prior = build([["P2", "post_sb", 50], ["P3", "post_bb", 100], ["P1", "raise", 300]]);
    // P2 has 50 in; reaching 400 (add 350) is a 100 increment over 300 → short.
    expect(validateAction(THREE, prior, BUTTON, propose("P2", "raise", 350)).code).toBe("BELOW_MIN_RAISE");
    // Reaching 500 (add 450) is a full 200 increment → legal.
    expect(validateAction(THREE, prior, BUTTON, propose("P2", "raise", 450)).valid).toBe(true);
  });
});

describe("validateAction — BB option", () => {
  it("when action is folded/called around to the BB, the BB may CHECK or RAISE", () => {
    // SB completes, UTG calls → BB faces no extra; BB has its option.
    const prior = build([
      ["P2", "post_sb", 50], ["P3", "post_bb", 100],
      ["P1", "call", 100], ["P2", "call", 50],
    ]);
    expect(validateAction(THREE, prior, BUTTON, propose("P3", "check", 0)).valid).toBe(true);
    // BB raises its option: to 300 (add 200) over highest 100 → full increment.
    expect(validateAction(THREE, prior, BUTTON, propose("P3", "raise", 200)).valid).toBe(true);
  });
});

describe("validateAction — street reset on the flop", () => {
  const closedPreflop = build([
    ["P2", "post_sb", 50], ["P3", "post_bb", 100],
    ["P1", "call", 100], ["P2", "call", 50], ["P3", "check", 0],
  ]);
  it("first flop action: CHECK is legal when nobody has bet", () => {
    expect(validateAction(THREE, closedPreflop, BUTTON, propose("P2", "check", 0, "flop")).valid).toBe(true);
  });
  it("a sub-BB flop bet (not all-in) is BELOW_MIN_RAISE; a full BB bet is legal", () => {
    expect(validateAction(THREE, closedPreflop, BUTTON, propose("P2", "bet", 50, "flop")).code).toBe("BELOW_MIN_RAISE");
    expect(validateAction(THREE, closedPreflop, BUTTON, propose("P2", "bet", 100, "flop")).valid).toBe(true);
  });
});

describe("validateAction — physical invariants still hold", () => {
  it("cannot CHECK facing a bet, and cannot exceed the stack", () => {
    const prior = build([["P2", "post_sb", 50], ["P3", "post_bb", 100]]);
    expect(validateAction(THREE, prior, BUTTON, propose("P1", "check", 0)).code).toBe("CHECK_FACING_BET");
    expect(validateAction(THREE, prior, BUTTON, propose("P1", "raise", 99999)).code).toBe("AMOUNT_EXCEEDS_STACK");
  });
});

describe("validateAction — short all-in does not reopen betting", () => {
  // A short all-in that is BELOW a full raise increment must NOT reopen the action
  // for a player who has already acted — they may only call or fold.
  it("a player who already acted cannot re-raise after a non-reopening short all-in", () => {
    const seeds: PlayerSeed[] = [
      { player_id: "B1", seat_number: 1, starting_stack: 350 }, // button, short stack
      { player_id: "SB", seat_number: 2, starting_stack: 10000 },
      { player_id: "BB", seat_number: 3, starting_stack: 10000 },
      { player_id: "UTG", seat_number: 4, starting_stack: 10000 },
      { player_id: "MP", seat_number: 5, starting_stack: 10000 },
    ];
    const prior = build([
      ["SB", "post_sb", 50], ["BB", "post_bb", 100],
      ["UTG", "raise", 300],   // to 300, minRaise increment 200
      ["MP", "call", 300],     // calls to 300
      ["B1", "all_in", 350],   // short all-in to 350: increment 50 < 200 → does NOT reopen
    ]);
    // UTG already acted; facing a non-reopening short all-in it may only call/fold.
    const r = validateAction(seeds, prior, 1, propose("UTG", "raise", 300, "preflop"));
    expect(r).toMatchObject({ valid: false, code: "ACTION_NOT_REOPENED" });
    expect(validateAction(seeds, prior, 1, propose("UTG", "all_in", 9700, "preflop"))).toMatchObject({
      valid: false,
      code: "ACTION_NOT_REOPENED",
    });
    expect(validateAction(seeds, prior, 1, propose("UTG", "call", 50, "preflop")).valid).toBe(true);
    // Players who have not acted yet retain their raise right.
    expect(validateAction(seeds, prior, 1, propose("SB", "raise", 500, "preflop")).valid).toBe(true);
  });

  it("a full later raise reopens action for players who already acted", () => {
    const prior = build([
      ["P2", "post_sb", 50], ["P3", "post_bb", 100],
      ["P1", "raise", 300],
      ["P2", "raise", 450], // reaches 500: a full +200 raise
    ]);
    expect(validateAction(THREE, prior, BUTTON, propose("P1", "raise", 400))).toMatchObject({
      valid: true,
      normalizedAmount: 400, // P1 reaches 700: another full +200 raise
    });
  });
});

describe("validateAction — TDA Rule 47 player-specific cumulative short all-ins", () => {
  it("reopens only the player who has cumulatively faced one full raise", () => {
    const seeds: PlayerSeed[] = [
      { player_id: "A", seat_number: 1, starting_stack: 2_000 },
      { player_id: "C", seat_number: 2, starting_stack: 2_000 },
      { player_id: "SHORT_125", seat_number: 3, starting_stack: 125 },
      { player_id: "SHORT_200", seat_number: 4, starting_stack: 200 },
      { player_id: "SB", seat_number: 5, starting_stack: 2_000 },
      { player_id: "BB", seat_number: 6, starting_stack: 2_000 },
    ];
    const prior = build([
      ["SB", "post_sb", 50],
      ["BB", "post_bb", 100],
      ["A", "call", 100],
      ["SHORT_125", "all_in", 125],
      ["C", "call", 125],
      ["SHORT_200", "all_in", 200],
    ]);

    const runtime = reduceHand(seeds, prior, 1);
    const byId = Object.fromEntries(runtime.players.map((player) => [player.player_id, player]));
    expect(runtime.minRaise).toBe(100);
    expect(byId.A).toMatchObject({ last_action_wager_level: 100, can_raise: true });
    expect(byId.C).toMatchObject({ last_action_wager_level: 125, can_raise: false });

    // A now faces 200 - 100 = 100, one full increment, so raising is reopened.
    expect(validateAction(seeds, prior, 1, propose("A", "raise", 200))).toMatchObject({ valid: true, code: "OK" });
    // C faces only 200 - 125 = 75, so the same raise and an all-in raise stay closed.
    expect(validateAction(seeds, prior, 1, propose("C", "raise", 175))).toMatchObject({
      valid: false,
      code: "ACTION_NOT_REOPENED",
    });
    expect(validateAction(seeds, prior, 1, propose("C", "all_in", 0))).toMatchObject({
      valid: false,
      code: "ACTION_NOT_REOPENED",
    });
    expect(validateAction(seeds, prior, 1, propose("C", "call", 75))).toMatchObject({ valid: true, code: "OK" });
  });
});
