// tests/pokerEngine/goldenHands.test.ts
// GOLDEN HAND-HISTORY FIXTURES — the hardest settlement shapes, each pinned to
// an EXACT hand-computed result (final stacks, per-pot awards, payouts, refund,
// reveals). Every golden replays through the real reducers via replayHand —
// which also asserts every engine invariant after every step — and is replayed
// TWICE to prove byte-identical determinism.
//
// Fixtures are TypeScript data (NOT JSON) on purpose: chips are bigint.
//
// Deal order (riggedDeck replicates it): one card per ACTIVE seat per round,
// clockwise from the SB (heads-up: SB = button), then the next 5 deck cards are
// the board. Odd chips go per-pot to winners nearest clockwise from the button.

import { describe, it, expect } from 'vitest';
import { replayHand, serializeForTransport } from '@engine/index.ts';
import type { HandScript } from '@engine/index.ts';
import { riggedDeck, si } from './fixtures.ts';

const cfg = (button: number, sb: bigint, bb: bigint) =>
  ({ handId: 'g', tableId: 't', handNo: 1, buttonSeat: button, sb, bb });

interface GoldenExpect {
  endedBy: 'fold' | 'showdown';
  /** seat -> final stack — EVERY seat, exact. */
  finalStacks: Record<number, bigint>;
  /** EXACT payouts object: seats that won nothing must be ABSENT (engine never writes 0n). */
  payouts: Record<number, bigint>;
  potAwards: { potIndex: number; amount: bigint; winners: number[] }[];
  refund?: { seat: number; amount: bigint };
  /** Seats whose cards are revealed (compared as a set). Empty on fold-to-one. */
  revealedSeats: number[];
}

interface GoldenHand { name: string; script: HandScript; expect: GoldenExpect }

// A board no test hand connects with beyond its pocket pair (no straight/flush).
const DRY_BOARD: ['2c', '7h', '9c', 'Th', '3d'] = ['2c', '7h', '9c', 'Th', '3d'];
// Broadway board with no possible flush relevance — the board plays for low holes.
const BOARD_PLAYS: ['As', 'Ks', 'Qd', 'Jc', 'Th'] = ['As', 'Ks', 'Qd', 'Jc', 'Th'];

const GOLDEN: GoldenHand[] = [
  {
    // HU: SB=button shoves, BB calls. Single pot, one winner, exact stacks.
    name: 'heads-up all-in preflop, one winner takes exactly the whole pot',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['As', 'Ah'], 2: ['Kd', 'Kc'] }, board: ['2c', '7d', '9h', 'Ts', '3s'] }),
      seats: si([1000n, 1000n]),
      actions: [{ type: 'allin', seat: 1 }, { type: 'allin', seat: 2 }],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 2000n, 2: 0n },
      payouts: { 1: 2000n },
      potAwards: [{ potIndex: 0, amount: 2000n, winners: [1] }],
      revealedSeats: [1, 2],
    },
  },
  {
    // Short UTG all-in creates a main pot it wins while a bigger pair takes the side pot.
    name: 'three-way all-in: short stack wins main, different winner takes the side pot',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['As', 'Ad'], 2: ['Ks', 'Kd'], 3: ['Qs', 'Qd'] }, board: DRY_BOARD }),
      seats: si([300n, 1000n, 1000n]),
      actions: [
        { type: 'allin', seat: 1 },
        { type: 'allin', seat: 2 },
        { type: 'call', seat: 3 }, // exact-stack call => all-in
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 900n, 2: 1400n, 3: 0n },
      payouts: { 1: 900n, 2: 1400n },
      potAwards: [
        { potIndex: 0, amount: 900n, winners: [1] },   // 300×3
        { potIndex: 1, amount: 1400n, winners: [2] },  // 700×2
      ],
      revealedSeats: [1, 2, 3],
    },
  },
  {
    // Four commitment levels => three layered pots, each with its own winner.
    name: 'four-way all-in: three side-pot layers, exact per-pot awards',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({
        button: 1,
        holeBySeat: { 1: ['Ks', 'Kd'], 2: ['Qs', 'Qd'], 3: ['Js', 'Jd'], 4: ['As', 'Ad'] },
        board: DRY_BOARD,
      }),
      seats: si([400n, 800n, 800n, 200n]),
      actions: [
        { type: 'allin', seat: 4 },  // UTG, 200
        { type: 'allin', seat: 1 },  // 400
        { type: 'allin', seat: 2 },  // SB, 800
        { type: 'call', seat: 3 },   // BB exact-stack call, 800
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 600n, 2: 800n, 3: 0n, 4: 800n },
      payouts: { 1: 600n, 2: 800n, 4: 800n },
      potAwards: [
        { potIndex: 0, amount: 800n, winners: [4] },  // 200×4 — AA
        { potIndex: 1, amount: 600n, winners: [1] },  // 200×3 — KK
        { potIndex: 2, amount: 800n, winners: [2] },  // 400×2 — QQ beats JJ
      ],
      revealedSeats: [1, 2, 3, 4],
    },
  },
  {
    // The covering shove is only matched up to 500: 1500 returns BEFORE any award.
    name: 'overbet all-in: uncalled excess is refunded and recorded in result + events',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['Ks', 'Kd'], 2: ['As', 'Ad'] }, board: DRY_BOARD }),
      seats: si([2000n, 500n]),
      actions: [{ type: 'allin', seat: 1 }, { type: 'allin', seat: 2 }],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 1500n, 2: 1000n },
      payouts: { 2: 1000n },
      potAwards: [{ potIndex: 0, amount: 1000n, winners: [2] }],
      refund: { seat: 1, amount: 1500n },
      revealedSeats: [1, 2],
    },
  },
  {
    // Both holes are dead — the broadway board plays for both, even split, no odd chip.
    name: 'split main pot: board plays for both players',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['2c', '3d'], 2: ['2h', '3h'] }, board: BOARD_PLAYS }),
      seats: si([1000n, 1000n]),
      actions: [
        { type: 'call', seat: 1 }, { type: 'check', seat: 2 },   // preflop (BB option)
        { type: 'check', seat: 2 }, { type: 'check', seat: 1 },  // flop (BB first postflop HU)
        { type: 'check', seat: 2 }, { type: 'check', seat: 1 },  // turn
        { type: 'check', seat: 2 }, { type: 'check', seat: 1 },  // river
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 1000n, 2: 1000n },
      payouts: { 1: 100n, 2: 100n },
      potAwards: [{ potIndex: 0, amount: 200n, winners: [1, 2] }],
      revealedSeats: [1, 2],
    },
  },
  {
    // The SIDE pot itself splits: short stack wins the main, two identical hands chop the side.
    name: 'side pot split between two players while the short stack wins the main',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['As', 'Ad'], 2: ['Kc', 'Qc'], 3: ['Kd', 'Qd'] }, board: ['Ks', '7h', '9s', 'Th', '3d'] }),
      seats: si([200n, 600n, 600n]),
      actions: [
        { type: 'allin', seat: 1 },  // 200
        { type: 'allin', seat: 2 },  // 600
        { type: 'call', seat: 3 },   // exact-stack call, 600
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 600n, 2: 400n, 3: 400n },
      payouts: { 1: 600n, 2: 400n, 3: 400n },
      potAwards: [
        { potIndex: 0, amount: 600n, winners: [1] },     // 200×3 — AA
        { potIndex: 1, amount: 800n, winners: [2, 3] },  // 400×2 — identical KQ chop
      ],
      revealedSeats: [1, 2, 3],
    },
  },
  {
    // A 300-deep folder leaves dead money in every layer it reached — and can win nothing.
    name: 'folded raiser leaves dead money; absent from payouts and every winner list',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['Qs', 'Qd'], 2: ['Ks', 'Kd'], 3: ['As', 'Ad'] }, board: DRY_BOARD }),
      seats: si([1000n, 1200n, 600n]),
      actions: [
        { type: 'raise', seat: 1, amount: 300n },
        { type: 'allin', seat: 2 },  // 1200 over the top
        { type: 'allin', seat: 3 },  // 600 (call for less)
        { type: 'fold', seat: 1 },   // 300 stays in as dead money
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 700n, 2: 600n, 3: 1500n },
      payouts: { 3: 1500n },
      potAwards: [
        { potIndex: 0, amount: 900n, winners: [3] },  // 300×3 incl. seat 1's dead 300
        { potIndex: 1, amount: 600n, winners: [3] },  // 300×2
      ],
      refund: { seat: 2, amount: 600n },              // 1200 was only matched to 600
      revealedSeats: [2, 3],
    },
  },
  {
    // 230 over 200 is NOT a full raise: the original raiser may only fold or call
    // (a raise here would make replayHand throw — the script itself proves the rule).
    name: 'short all-in below min-raise does not reopen; caller settles two layers',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['Ks', 'Kd'], 2: ['Qs', 'Qd'], 3: ['As', 'Ad'] }, board: DRY_BOARD }),
      seats: si([1000n, 1000n, 230n]),
      actions: [
        { type: 'raise', seat: 1, amount: 200n },
        { type: 'fold', seat: 2 },
        { type: 'allin', seat: 3 },              // 230: +30 < 100 => no reopen
        { type: 'call', seat: 1 },               // only fold/call are legal here
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 770n, 2: 950n, 3: 510n },
      payouts: { 3: 510n },
      potAwards: [
        { potIndex: 0, amount: 150n, winners: [3] },  // 50×3 (SB's dead 50)
        { potIndex: 1, amount: 360n, winners: [3] },  // 180×2
      ],
      revealedSeats: [1, 3],
    },
  },
  {
    // 400 over 200 IS a full raise: betting reopens and the original raiser re-raises —
    // legal only because the reopen happened (replayHand would reject it otherwise).
    name: 'legal full raise reopens betting; re-raise settles cleanly at showdown',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['As', 'Ad'], 2: ['Qs', 'Qd'], 3: ['Ks', 'Kd'] }, board: DRY_BOARD }),
      seats: si([1000n, 1000n, 1000n]),
      actions: [
        { type: 'raise', seat: 1, amount: 200n },
        { type: 'fold', seat: 2 },
        { type: 'raise', seat: 3, amount: 400n },  // full raise => reopens
        { type: 'raise', seat: 1, amount: 800n },  // re-raise (proof of reopen)
        { type: 'call', seat: 3 },
        { type: 'check', seat: 3 }, { type: 'check', seat: 1 },  // flop
        { type: 'check', seat: 3 }, { type: 'check', seat: 1 },  // turn
        { type: 'check', seat: 3 }, { type: 'check', seat: 1 },  // river
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 1850n, 2: 950n, 3: 200n },
      payouts: { 1: 1650n },
      potAwards: [
        { potIndex: 0, amount: 150n, winners: [1] },   // 50×3
        { potIndex: 1, amount: 1500n, winners: [1] },  // 750×2
      ],
      revealedSeats: [1, 3],
    },
  },
  {
    // Fold-to-one: only the matched 100 is contested; the raiser's extra 200 comes back.
    name: 'fold-to-one after a raise refunds the uncalled amount, reveals nothing',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['As', 'Ad'], 2: ['Ks', 'Kd'], 3: ['Qs', 'Qd'] }, board: DRY_BOARD }),
      seats: si([1000n, 1000n, 1000n]),
      actions: [
        { type: 'raise', seat: 1, amount: 300n },
        { type: 'fold', seat: 2 },
        { type: 'fold', seat: 3 },
      ],
    },
    expect: {
      endedBy: 'fold',
      finalStacks: { 1: 1150n, 2: 950n, 3: 900n },
      payouts: { 1: 250n },
      potAwards: [{ potIndex: 0, amount: 250n, winners: [1] }],
      refund: { seat: 1, amount: 200n },
      revealedSeats: [],
    },
  },
  {
    // Three all-ins at the SAME level must collapse into exactly ONE pot.
    name: 'equal-stack triple all-in produces a single pot, no spurious layers',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['Ks', 'Kd'], 2: ['As', 'Ad'], 3: ['Qs', 'Qd'] }, board: DRY_BOARD }),
      seats: si([500n, 500n, 500n]),
      actions: [
        { type: 'allin', seat: 1 },
        { type: 'allin', seat: 2 },
        { type: 'call', seat: 3 },  // exact-stack call
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 0n, 2: 1500n, 3: 0n },
      payouts: { 2: 1500n },
      potAwards: [{ potIndex: 0, amount: 1500n, winners: [2] }],
      revealedSeats: [1, 2, 3],
    },
  },
  {
    // Posting the blinds puts BOTH players all-in: zero actions, immediate runout,
    // and the BB's unmatchable 50 comes straight back (all-in for less is a call).
    name: 'everyone all-in from the blinds: empty action log, refund, immediate runout',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['As', 'Ad'], 2: ['Ks', 'Kd'] }, board: DRY_BOARD }),
      seats: si([50n, 100n]),
      actions: [],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 100n, 2: 50n },
      payouts: { 1: 100n },
      potAwards: [{ potIndex: 0, amount: 100n, winners: [1] }],
      refund: { seat: 2, amount: 50n },
      revealedSeats: [1, 2],
    },
  },
  {
    // sb=1/bb=2: the folded SB's single dead chip makes BOTH layers odd-sized.
    // Per-pot odd chips go to the winner nearest clockwise from the button (seat 3).
    name: 'two-way chop with dead money: odd chip goes clockwise from the button',
    script: {
      config: cfg(1, 1n, 2n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['2c', '3d'], 2: ['9c', '9d'], 3: ['2h', '3s'] }, board: BOARD_PLAYS }),
      seats: si([100n, 100n, 100n]),
      actions: [
        { type: 'call', seat: 1 },
        { type: 'fold', seat: 2 },   // SB's 1 chip is dead money
        { type: 'check', seat: 3 },  // BB option
        { type: 'check', seat: 3 }, { type: 'check', seat: 1 },  // flop
        { type: 'check', seat: 3 }, { type: 'check', seat: 1 },  // turn
        { type: 'check', seat: 3 }, { type: 'check', seat: 1 },  // river
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 100n, 2: 99n, 3: 101n },
      payouts: { 1: 2n, 3: 3n },
      potAwards: [
        { potIndex: 0, amount: 3n, winners: [1, 3] },  // 1×3 (dead level) => 2/1 split
        { potIndex: 1, amount: 2n, winners: [1, 3] },  // 1×2 => 1/1
      ],
      revealedSeats: [1, 3],
    },
  },
  {
    // Three-way chop, ONE odd chip in the dead-money layer.
    name: 'three-way chop with one odd chip: first winner clockwise from button gets it',
    script: {
      config: cfg(1, 1n, 2n),
      deck: riggedDeck({
        button: 1,
        holeBySeat: { 1: ['2h', '3s'], 2: ['9c', '9d'], 3: ['2d', '4c'], 4: ['2c', '3d'] },
        board: BOARD_PLAYS,
      }),
      seats: si([100n, 100n, 100n, 100n]),
      actions: [
        { type: 'call', seat: 4 },
        { type: 'call', seat: 1 },
        { type: 'fold', seat: 2 },   // dead 1
        { type: 'check', seat: 3 },  // BB option
        { type: 'check', seat: 3 }, { type: 'check', seat: 4 }, { type: 'check', seat: 1 },  // flop
        { type: 'check', seat: 3 }, { type: 'check', seat: 4 }, { type: 'check', seat: 1 },  // turn
        { type: 'check', seat: 3 }, { type: 'check', seat: 4 }, { type: 'check', seat: 1 },  // river
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 100n, 2: 99n, 3: 101n, 4: 100n },
      payouts: { 1: 2n, 3: 3n, 4: 2n },
      potAwards: [
        { potIndex: 0, amount: 4n, winners: [1, 3, 4] },  // 1×4 => 2/1/1 (odd to seat 3)
        { potIndex: 1, amount: 3n, winners: [1, 3, 4] },  // 1×3 => 1/1/1
      ],
      revealedSeats: [1, 3, 4],
    },
  },
  {
    // Three-way chop, TWO odd chips in one layer: the two winners nearest clockwise
    // from the button (seats 3 then 4) each get one.
    name: 'three-way chop with two odd chips: both go to the nearest clockwise winners',
    script: {
      config: cfg(1, 2n, 3n),
      deck: riggedDeck({
        button: 1,
        holeBySeat: { 1: ['2h', '3s'], 2: ['9c', '9d'], 3: ['2d', '4c'], 4: ['2c', '3d'] },
        board: BOARD_PLAYS,
      }),
      seats: si([100n, 100n, 100n, 100n]),
      actions: [
        { type: 'call', seat: 4 },
        { type: 'call', seat: 1 },
        { type: 'fold', seat: 2 },   // dead 2
        { type: 'check', seat: 3 },  // BB option
        { type: 'check', seat: 3 }, { type: 'check', seat: 4 }, { type: 'check', seat: 1 },  // flop
        { type: 'check', seat: 3 }, { type: 'check', seat: 4 }, { type: 'check', seat: 1 },  // turn
        { type: 'check', seat: 3 }, { type: 'check', seat: 4 }, { type: 'check', seat: 1 },  // river
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 100n, 2: 98n, 3: 101n, 4: 101n },
      payouts: { 1: 3n, 3: 4n, 4: 4n },
      potAwards: [
        { potIndex: 0, amount: 8n, winners: [1, 3, 4] },  // 2×4 => 3/3/2 (odds to 3, 4)
        { potIndex: 1, amount: 3n, winners: [1, 3, 4] },  // 1×3 => 1/1/1
      ],
      revealedSeats: [1, 3, 4],
    },
  },
  {
    // Regression (GE-1.6 deal-ring fix): posting the blind puts the BB all-in.
    // The BB must STILL be dealt exactly 2 cards — the old deal loop walked the
    // post-blind 'active' statuses, skipped the all-in BB, and dealt another seat
    // 4 cards (invisible to chip conservation; caught only by card integrity).
    name: 'big blind all-in from posting is still dealt in and wins at showdown',
    script: {
      config: cfg(1, 50n, 100n),
      deck: riggedDeck({ button: 1, holeBySeat: { 1: ['Ks', 'Kd'], 2: ['Qs', 'Qd'], 3: ['As', 'Ad'] }, board: DRY_BOARD }),
      seats: si([1000n, 1000n, 100n]),  // seat 3 (BB) has exactly the blind
      actions: [
        { type: 'call', seat: 1 },
        { type: 'fold', seat: 2 },
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 900n, 2: 950n, 3: 250n },
      payouts: { 3: 250n },
      potAwards: [
        { potIndex: 0, amount: 150n, winners: [3] },  // 50×3 incl. SB's dead 50
        { potIndex: 1, amount: 100n, winners: [3] },  // 50×2
      ],
      revealedSeats: [1, 3],
    },
  },
  {
    // Mid-hand fold INSIDE a side-pot layer: seat 3 folds at 7 between the all-in (4)
    // and the bettors (10), so the middle layer is 9 chips — an ODD split for the
    // two identical hands that chop it (and the layer above splits evenly).
    name: 'side pot with odd chip: dead money inside the layer splits 5/4 clockwise',
    script: {
      config: cfg(1, 1n, 2n),
      deck: riggedDeck({
        button: 1,
        holeBySeat: { 1: ['Kc', 'Qc'], 2: ['Kd', 'Qd'], 3: ['9c', '9d'], 4: ['As', 'Ad'] },
        board: ['Kh', '7s', 'Ts', '2h', '3c'],
      }),
      seats: si([100n, 100n, 100n, 4n]),
      actions: [
        { type: 'allin', seat: 4 },               // UTG all-in 4 (full raise over bb 2)
        { type: 'call', seat: 1 },
        { type: 'call', seat: 2 },
        { type: 'call', seat: 3 },
        { type: 'bet', seat: 2, amount: 3n },     // flop
        { type: 'call', seat: 3 },
        { type: 'raise', seat: 1, amount: 6n },
        { type: 'call', seat: 2 },
        { type: 'fold', seat: 3 },                // folds at total 7 => dead inside the layer
        { type: 'check', seat: 2 }, { type: 'check', seat: 1 },  // turn
        { type: 'check', seat: 2 }, { type: 'check', seat: 1 },  // river
      ],
    },
    expect: {
      endedBy: 'showdown',
      finalStacks: { 1: 97n, 2: 98n, 3: 93n, 4: 16n },
      payouts: { 1: 7n, 2: 8n, 4: 16n },
      potAwards: [
        { potIndex: 0, amount: 16n, winners: [4] },     // 4×4 — AA
        { potIndex: 1, amount: 9n, winners: [1, 2] },   // (7-4)×3 incl. dead => 4/5 (odd to seat 2)
        { potIndex: 2, amount: 6n, winners: [1, 2] },   // (10-7)×2 => 3/3
      ],
      revealedSeats: [1, 2, 4],
    },
  },
];

describe('golden hand fixtures (exact settlement, deterministic replay)', () => {
  for (const g of GOLDEN) {
    it(g.name, () => {
      const initialTotal = g.script.seats.reduce((a, s) => a + s.stack, 0n);

      // replayHand asserts every engine invariant after every step
      const r1 = replayHand(g.script);
      const r2 = replayHand(g.script);

      // determinism: bit-for-bit identical state AND event stream
      expect(serializeForTransport(r1.state)).toBe(serializeForTransport(r2.state));
      expect(serializeForTransport(r1.events)).toBe(serializeForTransport(r2.events));

      const st = r1.state;
      expect(st.status).toBe('complete');
      expect(st.result?.endedBy).toBe(g.expect.endedBy);

      // exact final stacks + conservation
      for (const [seat, stack] of Object.entries(g.expect.finalStacks)) {
        expect(st.seats.find((s) => s.seat === Number(seat))!.stack, `stack of seat ${seat}`).toBe(stack);
      }
      expect(st.seats.reduce((a, s) => a + s.stack, 0n)).toBe(initialTotal);

      // exact awards + payouts (losers/folders must be ABSENT from payouts)
      expect(st.result!.potAwards).toEqual(g.expect.potAwards);
      expect(st.result!.payouts).toEqual(g.expect.payouts);

      // refund: in the result AND as an `uncalled_returned` event BEFORE the award
      if (g.expect.refund) {
        expect(st.result!.refund).toEqual(g.expect.refund);
        const types = r1.events.map((e) => e.type);
        const refundIdx = types.indexOf('uncalled_returned');
        expect(refundIdx).toBeGreaterThanOrEqual(0);
        expect(refundIdx).toBeLessThan(types.indexOf('pot_awarded'));
        expect(r1.events[refundIdx].payload).toEqual({
          seat: g.expect.refund.seat,
          amount: g.expect.refund.amount.toString(),
        });
      } else {
        expect(st.result!.refund).toBeUndefined();
        expect(r1.events.some((e) => e.type === 'uncalled_returned')).toBe(false);
      }

      // reveals (as a set): contesting seats only; fold-to-one reveals nothing
      const revealed = st.seats.filter((s) => s.revealedCards !== undefined).map((s) => s.seat).sort();
      expect(revealed).toEqual([...g.expect.revealedSeats].sort());

      // folded seats can never appear in any winner list
      const folded = new Set(st.seats.filter((s) => s.status === 'folded').map((s) => s.seat));
      for (const a of st.result!.potAwards) {
        for (const w of a.winners) expect(folded.has(w), `folded seat ${w} won pot ${a.potIndex}`).toBe(false);
      }
    });
  }
});
