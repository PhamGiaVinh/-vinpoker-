import { describe, it, expect } from "vitest";
import * as server from "@tracker-engine/handState.ts";
import * as client from "@/lib/tracker-poker/handState";

// The server hand-state reducer (trackerEngine/handState.ts) is the AUTHORITY; the
// client copy (src/lib/tracker-poker/handState.ts) is a verbatim mirror the Phase G3
// resettle-forward UI runs in the browser (the client Vite build cannot import the
// server tree). This test fails the moment the two reducers drift — change BOTH
// files in the same PR. Inputs are typed against the server unions and passed to the
// client copy too (its unions are byte-identical).

// The server module only re-exports STREET_ORDER (its types live in ./types.ts), so use
// the client copy's exported types for the literals — they are byte-identical unions and
// assignable to the server reducer's parameters.
type Seed = client.PlayerSeed;
type Action = client.ActionRow;

const A = (
  player_id: string,
  street: client.Street,
  action_type: client.TrackerActionType,
  action_amount: number,
  action_order: number,
): Action => ({ player_id, street, action_type, action_amount, action_order });

const S = (player_id: string, seat_number: number, starting_stack: number): Seed => ({
  player_id,
  seat_number,
  starting_stack,
});

interface Case {
  name: string;
  seeds: Seed[];
  actions: Action[];
  buttonSeat: number;
}

const cases: Case[] = [
  {
    name: "heads-up: SB completes, BB checks",
    seeds: [S("P1", 1, 1000), S("P2", 2, 1000)],
    actions: [
      A("P1", "preflop", "post_sb", 50, 1),
      A("P2", "preflop", "post_bb", 100, 2),
      A("P1", "preflop", "call", 50, 3),
      A("P2", "preflop", "check", 0, 4),
    ],
    buttonSeat: 1,
  },
  {
    name: "3-way: raise, call, fold",
    seeds: [S("P1", 1, 5000), S("P2", 2, 5000), S("P3", 3, 5000)],
    actions: [
      A("P1", "preflop", "post_sb", 50, 1),
      A("P2", "preflop", "post_bb", 100, 2),
      A("P3", "preflop", "raise", 300, 3),
      A("P1", "preflop", "fold", 0, 4),
      A("P2", "preflop", "call", 200, 5),
    ],
    buttonSeat: 1,
  },
  {
    name: "short all-in + two coverers (side-pot caps)",
    seeds: [S("P1", 1, 2000), S("P2", 2, 2000), S("P3", 3, 300)],
    actions: [
      A("P1", "preflop", "post_sb", 50, 1),
      A("P2", "preflop", "post_bb", 100, 2),
      A("P3", "preflop", "all_in", 300, 3),
      A("P1", "preflop", "all_in", 1950, 4),
      A("P2", "preflop", "all_in", 1900, 5),
    ],
    buttonSeat: 1,
  },
  {
    name: "antes + blinds + multi-street to the river",
    seeds: [S("P1", 1, 10000), S("P2", 2, 10000), S("P3", 3, 10000)],
    actions: [
      A("P1", "preflop", "post_ante", 25, 1),
      A("P2", "preflop", "post_ante", 25, 2),
      A("P3", "preflop", "post_ante", 25, 3),
      A("P1", "preflop", "post_sb", 50, 4),
      A("P2", "preflop", "post_bb", 100, 5),
      A("P3", "preflop", "call", 100, 6),
      A("P1", "preflop", "call", 50, 7),
      A("P2", "preflop", "check", 0, 8),
      A("P1", "flop", "check", 0, 9),
      A("P2", "flop", "bet", 200, 10),
      A("P3", "flop", "call", 200, 11),
      A("P1", "flop", "fold", 0, 12),
      A("P2", "turn", "check", 0, 13),
      A("P3", "turn", "check", 0, 14),
      A("P2", "river", "bet", 500, 15),
      A("P3", "river", "fold", 0, 16),
    ],
    buttonSeat: 1,
  },
  {
    name: "sub-BB all-in does not reopen",
    seeds: [S("P1", 1, 100), S("P2", 2, 5000), S("P3", 3, 5000)],
    actions: [
      A("P2", "preflop", "post_sb", 50, 1),
      A("P3", "preflop", "post_bb", 100, 2),
      A("P1", "preflop", "all_in", 100, 3),
      A("P2", "preflop", "call", 50, 4),
      A("P3", "preflop", "check", 0, 5),
    ],
    buttonSeat: 1,
  },
  {
    name: "bet / raise / re-raise reopen tracking",
    seeds: [S("P1", 1, 8000), S("P2", 2, 8000)],
    actions: [
      A("P1", "preflop", "post_sb", 50, 1),
      A("P2", "preflop", "post_bb", 100, 2),
      A("P1", "preflop", "raise", 250, 3),
      A("P2", "preflop", "raise", 700, 4),
      A("P1", "preflop", "call", 500, 5),
    ],
    buttonSeat: 1,
  },
  {
    name: "unknown player in stream is ignored",
    seeds: [S("P1", 1, 1000), S("P2", 2, 1000)],
    actions: [
      A("P1", "preflop", "post_sb", 50, 1),
      A("P2", "preflop", "post_bb", 100, 2),
      A("GHOST", "preflop", "raise", 999, 3),
      A("P1", "preflop", "call", 50, 4),
      A("P2", "preflop", "check", 0, 5),
    ],
    buttonSeat: 1,
  },
  {
    name: "out-of-order stream is sorted by action_order",
    seeds: [S("P1", 1, 1000), S("P2", 2, 1000)],
    actions: [
      A("P2", "preflop", "check", 0, 4),
      A("P1", "preflop", "call", 50, 3),
      A("P2", "preflop", "post_bb", 100, 2),
      A("P1", "preflop", "post_sb", 50, 1),
    ],
    buttonSeat: 1,
  },
];

describe("hand-state reducer parity (server copy === client copy)", () => {
  it("reduceHand matches on every case", () => {
    for (const c of cases) {
      const s = server.reduceHand(c.seeds, c.actions, c.buttonSeat);
      const k = client.reduceHand(c.seeds, c.actions, c.buttonSeat);
      expect(k, c.name).toEqual(s);
    }
  });

  it("nextToAct matches on every case", () => {
    for (const c of cases) {
      expect(client.nextToAct(c.seeds, c.actions, c.buttonSeat), c.name).toEqual(
        server.nextToAct(c.seeds, c.actions, c.buttonSeat),
      );
    }
  });

  it("isBettingRoundComplete matches on every case", () => {
    for (const c of cases) {
      const s = server.reduceHand(c.seeds, c.actions, c.buttonSeat);
      const k = client.reduceHand(c.seeds, c.actions, c.buttonSeat);
      expect(client.isBettingRoundComplete(k), c.name).toEqual(server.isBettingRoundComplete(s));
    }
  });
});
