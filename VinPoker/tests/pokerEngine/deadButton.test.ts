// tests/pokerEngine/deadButton.test.ts
// GE-1 tournament forward-moving ("dead") button — the PURE placement helper
// (nextButtonTournament) re-tested against the engine, PLUS the createHand
// integration that actually deals a hand with a dead button and/or dead SB.
//
// Source parity: Part A mirrors the tracker-side DB-1 bust matrix
// (src/lib/tournament/deadButton.ts + tests/trackerEngine/deadButton.test.ts) so
// the operator-assist suggestion and the authoritative server agree seat-for-seat.
// Part B+ prove the server actually plays the suggestion: BB always posts, the SB
// posts only when live, the button may sit on an empty seat, dealing/turn-order/
// odd-chip all stay correct, and every step keeps the engine invariants + replays.

import { describe, it, expect } from 'vitest';
import {
  createHand, applyAction, replayHand, checkInvariants,
  nextButtonTournament, makeDeck,
  clockwiseSeatOrder, distribute,
} from '@engine/index.ts';
import type { SeatInput, TournamentBlindPlacement } from '@engine/index.ts';
import { baseSeat, makeState, totalChips } from './fixtures.ts';

const seatsAt = (spec: { seat: number; stack: bigint }[]): SeatInput[] =>
  spec.map((s) => ({ seat: s.seat, playerId: `p${s.seat}`, stack: s.stack }));

const six = (occupiedSeats: number[], prevBbSeat: number | null) =>
  nextButtonTournament({ maxSeats: 6, occupiedSeats, prevBbSeat });

// ── Part A — the dead-button placement (full DB-1 bust matrix) ────────────────
// Prior hand on a 6-max: button=1, SB=2, BB=3 (so prevBbSeat = 3).
describe('nextButtonTournament — TDA forward-moving (dead) button', () => {
  it('no bust: blinds + button each advance one live seat', () => {
    expect(six([1, 2, 3, 4, 5, 6], 3)).toEqual({ buttonSeat: 2, sbSeat: 3, bbSeat: 4, deadButton: false, deadSb: false });
  });

  it('bust the BUTTON (seat 1): no dead — button/SB/BB are all live', () => {
    expect(six([2, 3, 4, 5, 6], 3)).toEqual({ buttonSeat: 2, sbSeat: 3, bbSeat: 4, deadButton: false, deadSb: false });
  });

  it('bust the SB (seat 2): DEAD BUTTON on the empty SB-1 seat', () => {
    expect(six([1, 3, 4, 5, 6], 3)).toEqual({ buttonSeat: 2, sbSeat: 3, bbSeat: 4, deadButton: true, deadSb: false });
  });

  it('bust the BB (seat 3): BB advances to 4, the old-BB seat is the DEAD SB', () => {
    expect(six([1, 2, 4, 5, 6], 3)).toEqual({ buttonSeat: 2, sbSeat: null, bbSeat: 4, deadButton: false, deadSb: true });
  });

  it('consecutive busts between button and BB (2 and 3 gone): DEAD button AND DEAD SB', () => {
    expect(six([1, 4, 5, 6], 3)).toEqual({ buttonSeat: 2, sbSeat: null, bbSeat: 4, deadButton: true, deadSb: true });
  });

  it('3-handed -> heads-up: button = SB = the prev BB, BB = the other live seat', () => {
    expect(six([3, 4], 3)).toEqual({ buttonSeat: 3, sbSeat: 3, bbSeat: 4, deadButton: false, deadSb: false });
  });

  it('heads-up edge: blinds swap (prevBb=4 -> button 4, BB 3)', () => {
    expect(six([3, 4], 4)).toEqual({ buttonSeat: 4, sbSeat: 4, bbSeat: 3, deadButton: false, deadSb: false });
  });

  it('BB advances with wrap-around (prevBb is the highest live seat)', () => {
    // prevBb=6 -> next live after 6 wraps to 1; SB=ringPrev(1)=6, button=ringPrev(6)=5.
    expect(six([1, 2, 3, 4, 5, 6], 6)).toEqual({ buttonSeat: 5, sbSeat: 6, bbSeat: 1, deadButton: false, deadSb: false });
  });

  it('no placement when <2 live or first hand (caller sets the button)', () => {
    expect(six([4], 3)).toBeNull();
    expect(six([1, 2, 3], null)).toBeNull();
  });

  it('ignores out-of-ring / duplicate seats defensively', () => {
    expect(six([1, 1, 3, 4, 5, 6, 99, 0], 3)).toEqual({ buttonSeat: 2, sbSeat: 3, bbSeat: 4, deadButton: true, deadSb: false });
  });
});

// ── Part B — createHand honours a DEAD BUTTON (empty button seat) ─────────────
describe('createHand — dead button (seat 2 busted, button is the empty seat)', () => {
  const placement = six([1, 3, 4, 5, 6], 3)!; // button 2 (DEAD), SB 3, BB 4
  const seats = seatsAt([1, 3, 4, 5, 6].map((seat) => ({ seat, stack: 1000n })));
  const r = createHand(
    { handId: 'h', tableId: 't', handNo: 2, buttonSeat: placement.buttonSeat, sb: 50n, bb: 100n, blindPlacement: placement },
    makeDeck(),
    seats,
  );
  const st = r.state;
  const seat = (n: number) => st.seats.find((s) => s.seat === n)!;

  it('marks the button on the empty seat but posts nothing there', () => {
    expect(st.buttonSeat).toBe(2);
    expect(st.seats.some((s) => s.seat === 2)).toBe(false); // no seat 2 exists
  });

  it('posts SB(3) and BB(4) only', () => {
    expect(seat(3).committed).toBe(50n);
    expect(seat(4).committed).toBe(100n);
    expect(st.pot).toBe(150n);
    expect(st.currentBet).toBe(100n);
    expect(st.aggressor).toBe(4);
  });

  it('UTG (first live after BB) is to act', () => {
    expect(st.toAct).toBe(5);
  });

  it('emits blinds_posted with the live SB/BB seats', () => {
    const bp = r.events.find((e) => e.type === 'blinds_posted')!;
    expect(bp.payload).toMatchObject({ sbSeat: 3, bbSeat: 4, sb: '50', bb: '100' });
  });

  it('deals two cards to every live seat and keeps invariants', () => {
    expect(st.seats.every((s) => s.holeCards.length === 2)).toBe(true);
    expect(checkInvariants(st, 5000n)).toEqual([]);
  });

  it('postflop turn order anchors on the live seat after the dead button', () => {
    // everyone folds round to the BB pre-flop is fold-to-one; instead call round
    // out so we reach a postflop street and verify firstActivePostflop.
    let s = st;
    for (const seatNo of [5, 6, 1, 3]) {            // 5,6,1 call; SB(3) calls
      s = applyAction(s, { type: 'call', seat: seatNo }).state;
    }
    s = applyAction(s, { type: 'check', seat: 4 }).state; // BB checks option -> flop
    expect(s.street).toBe('flop');
    // first to act postflop = first live seat clockwise from the DEAD button (2) = 3
    expect(s.toAct).toBe(3);
    expect(checkInvariants(s, 5000n)).toEqual([]);
  });
});

// ── Part C — createHand honours a DEAD SB (no small blind posted) ─────────────
describe('createHand — dead SB (seat 3 busted = old BB)', () => {
  const placement = six([1, 2, 4, 5, 6], 3)!; // button 2, SB null (DEAD), BB 4
  const seats = seatsAt([1, 2, 4, 5, 6].map((seat) => ({ seat, stack: 1000n })));
  const r = createHand(
    { handId: 'h', tableId: 't', handNo: 2, buttonSeat: placement.buttonSeat, sb: 50n, bb: 100n, blindPlacement: placement },
    makeDeck(),
    seats,
  );
  const st = r.state;

  it('posts ONLY the big blind (no SB chips enter the pot)', () => {
    expect(placement.sbSeat).toBeNull();
    expect(st.pot).toBe(100n);
    expect(st.seats.find((s) => s.seat === 4)!.committed).toBe(100n);
    expect(st.seats.filter((s) => s.committed > 0n).map((s) => s.seat)).toEqual([4]);
  });

  it('emits blinds_posted with a null SB seat and "0" SB amount', () => {
    const bp = r.events.find((e) => e.type === 'blinds_posted')!;
    expect(bp.payload).toMatchObject({ sbSeat: null, bbSeat: 4, sb: '0', bb: '100' });
  });

  it('UTG is to act and invariants hold', () => {
    expect(st.toAct).toBe(5);
    expect(checkInvariants(st, 5000n)).toEqual([]);
  });
});

// ── Part D — odd-chip distribution is correct with a DEAD button ──────────────
describe('distribute / clockwiseSeatOrder — dead button on an empty seat', () => {
  it('anchors the odd chip on the first live seat clockwise from the empty button', () => {
    const seats = [
      baseSeat({ seat: 1, stack: 0n }),
      baseSeat({ seat: 3, stack: 0n }),
      baseSeat({ seat: 4, stack: 0n }),
    ];
    // button is seat 2 — EMPTY, not present in `seats`.
    expect(clockwiseSeatOrder(seats, 2)).toEqual([3, 4, 1]);

    const st = makeState({ seats, pot: 101n, buttonSeat: 2 });
    const before = totalChips(st);
    const shares = distribute(st, 101n, [1, 3], 2);
    expect(shares[3]).toBe(51n); // seat 3 = first live clockwise from dead button (2)
    expect(shares[1]).toBe(50n);
    expect(st.pot).toBe(0n);
    expect(totalChips(st)).toBe(before); // conserved
  });
});

// ── Part E — a dead-button hand replays bit-for-bit ──────────────────────────
describe('replayHand — dead-button hand is deterministic', () => {
  it('reproduces the hand and stays consistent at every step', () => {
    const placement = six([1, 3, 4, 5, 6], 3)!; // button 2 DEAD, SB 3, BB 4
    const script = {
      config: { handId: 'h', tableId: 't', handNo: 2, buttonSeat: placement.buttonSeat, sb: 50n, bb: 100n, blindPlacement: placement },
      deck: makeDeck(),
      seats: seatsAt([1, 3, 4, 5, 6].map((seat) => ({ seat, stack: 1000n }))),
      actions: [
        { type: 'fold' as const, seat: 5 },
        { type: 'fold' as const, seat: 6 },
        { type: 'fold' as const, seat: 1 },
        { type: 'fold' as const, seat: 3 }, // fold-to-one: BB (4) wins
      ],
    };
    const rep = replayHand(script);
    expect(rep.state.status).toBe('complete');
    expect(rep.state.result?.endedBy).toBe('fold');
    expect(rep.state.result?.payouts[4]).toBeGreaterThan(0n);
    expect(rep.state.pot).toBe(0n);
    expect(checkInvariants(rep.state, 5000n)).toEqual([]);
    // BB never lost net chips winning unopposed; chips are conserved overall.
    expect(rep.state.seats.reduce((a, s) => a + s.stack, 0n)).toBe(5000n);
  });
});

// ── Part F — a tournament placement with NOTHING dead == cash placement ───────
// Proves the new branch does not diverge when the button/SB/BB are all live.
describe('createHand — non-dead tournament placement matches cash placement', () => {
  it('produces the same authoritative state as the legacy (no-placement) path', () => {
    const placement: TournamentBlindPlacement = six([1, 2, 3, 4, 5, 6], 3)!; // button 2, SB 3, BB 4 (all live)
    const stacks = seatsAt([1, 2, 3, 4, 5, 6].map((seat) => ({ seat, stack: 1000n })));
    const deck = makeDeck();

    const tour = createHand(
      { handId: 'h', tableId: 't', handNo: 2, buttonSeat: placement.buttonSeat, sb: 50n, bb: 100n, blindPlacement: placement },
      deck, stacks,
    ).state;
    const cash = createHand(
      { handId: 'h', tableId: 't', handNo: 2, buttonSeat: 2, sb: 50n, bb: 100n }, // legacy: button 2 is a live seat
      deck, stacks,
    ).state;

    // Same button, blinds, pot, turn pointer, per-seat chips and hole cards.
    expect(tour.buttonSeat).toBe(cash.buttonSeat);
    expect(tour.pot).toBe(cash.pot);
    expect(tour.toAct).toBe(cash.toAct);
    expect(tour.currentBet).toBe(cash.currentBet);
    expect(tour.aggressor).toBe(cash.aggressor);
    expect(tour.seats.map((s) => [s.seat, s.committed, s.stack])).toEqual(
      cash.seats.map((s) => [s.seat, s.committed, s.stack]),
    );
    expect(tour.seats.map((s) => s.holeCards)).toEqual(cash.seats.map((s) => s.holeCards));
    expect(tour.sidePots).toEqual(cash.sidePots);
  });
});
