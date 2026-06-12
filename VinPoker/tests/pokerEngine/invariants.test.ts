// tests/pokerEngine/invariants.test.ts
// Property-based invariants over thousands of random LEGAL action lines. Fixes the
// review's TT-F2/F3 generator weakness: heterogeneous/short stacks + an explicit
// all-in bias + randomized raise sizing actually reach multi-way all-ins, and a
// mechanical coverage guard FAILS if no run ever builds a real side pot.
//
// (The fold-to-one-no-reveal and short-all-in-no-reopen rules — formerly TODO
// stubs — are pinned by lifecycle.test.ts and betting.test.ts.)

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHand, legalActions, applyAction } from '@engine/index.ts';
import type { Action, HandState } from '@engine/index.ts';
import { mulberry32, si, totalChips } from './fixtures.ts';
import { makeDeck, shuffle } from '@engine/index.ts';

const bb = 100n;

function freshFromSeed(seed: number, nSeats: number): HandState {
  // heterogeneous, often-short stacks (1..12 big blinds) so all-ins create side pots
  const stacks = Array.from({ length: nSeats }, (_, i) => bb * BigInt(1 + ((seed * 7 + i * 13) % 12)));
  const deck = shuffle(makeDeck(), mulberry32(seed));
  return createHand(
    { handId: `h${seed}`, tableId: 't', handNo: 1, buttonSeat: 1, sb: 50n, bb },
    deck,
    si(stacks),
  ).state;
}

function chooseAction(state: HandState, pick: number): Action | null {
  const seat = state.toAct;
  if (seat == null) return null;
  const la = legalActions(state, seat);
  if (la.types.length === 0) return null;
  // bias toward all-in when it is available (drives multi-way all-in / side pots)
  if (la.types.includes('allin') && pick % 3 === 0) return { type: 'allin', seat };
  const t = la.types[pick % la.types.length];
  if (t === 'bet' || t === 'raise') {
    const span = la.maxRaiseTo - la.minRaiseTo;
    const amount = span <= 0n ? la.minRaiseTo : la.minRaiseTo + (BigInt(pick) % (span + 1n));
    return { type: t, seat, amount };
  }
  return { type: t, seat };
}

describe('engine invariants (property-based)', () => {
  it('conserves chips, never goes negative, keeps pots consistent across random legal lines', () => {
    let sidePotSeen = 0;

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99_999 }),
        fc.integer({ min: 2, max: 6 }),
        fc.array(fc.integer({ min: 0, max: 11 }), { maxLength: 160 }),
        (seed, nSeats, picks) => {
          let state = freshFromSeed(seed, nSeats);
          const start = totalChips(state);

          for (const p of picks) {
            if (state.status !== 'betting') break;
            const a = chooseAction(state, p);
            if (!a) break;
            const r = applyAction(state, a);
            if (r.error) continue; // illegal pick rejected; state unchanged
            state = r.state;

            // ── invariants after EVERY applied action ──
            expect(totalChips(state)).toBe(start);                  // Σ(stacks)+pot conserved
            expect(state.seats.every((s) => s.stack >= 0n)).toBe(true);
            expect(state.pot >= 0n).toBe(true);

            if (state.status === 'betting' && state.toAct != null) {
              const a2 = state.seats.find((s) => s.seat === state.toAct);
              expect(a2?.status).toBe('active'); // the seat to act is genuinely active
            }

            if (state.status === 'betting') {
              const spSum = state.sidePots.reduce((acc, x) => acc + x.amount, 0n);
              if (state.sidePots.length) {
                expect(spSum).toBe(state.pot); // side pots partition the pot exactly
                for (const pot of state.sidePots) {
                  for (const seatNo of pot.eligibleSeats) {
                    const seat = state.seats.find((x) => x.seat === seatNo)!;
                    expect(seat.status).not.toBe('folded'); // folded never eligible
                  }
                }
              }
              if (state.sidePots.length > 1) sidePotSeen++;
            }
          }

          // chips remain conserved after the hand completes (pot distributed to stacks)
          expect(totalChips(state)).toBe(start);
        },
      ),
      { numRuns: 400 },
    );

    // coverage guard: the side-pot invariants above must actually have been exercised
    expect(sidePotSeen).toBeGreaterThan(0);
  });
});
