// tests/pokerEngine/betting.test.ts
// Legal actions, blinds/positions, BB option, min-raise sizing, the sub-minimum
// all-in no-reopen rule, and rejection of out-of-turn / duplicate / illegal actions.

import { describe, it, expect } from 'vitest';
import { applyAction, legalActions } from '@engine/index.ts';
import { freshHand, play } from './fixtures.ts';

describe('blinds & positions', () => {
  it('heads-up: button posts SB and acts first preflop', () => {
    const st = freshHand([1000n, 1000n], { button: 1, sb: 50n, bb: 100n });
    expect(st.seats[0].committed).toBe(50n); // seat 1 = button = SB
    expect(st.seats[1].committed).toBe(100n); // seat 2 = BB
    expect(st.toAct).toBe(1); // SB/button acts first preflop heads-up
    expect(st.currentBet).toBe(100n);
  });

  it('3-handed: SB=button+1, BB=button+2, UTG acts first', () => {
    const st = freshHand([1000n, 1000n, 1000n], { button: 1 });
    expect(st.seats[1].committed).toBe(50n); // seat 2 SB
    expect(st.seats[2].committed).toBe(100n); // seat 3 BB
    expect(st.toAct).toBe(1); // UTG (left of BB)
  });
});

describe('legalActions', () => {
  it('offers fold/call/raise/allin to the SB facing the BB', () => {
    const st = freshHand([1000n, 1000n], { button: 1 });
    const la = legalActions(st, 1);
    expect(la.toCall).toBe(50n);
    expect(la.types).toEqual(expect.arrayContaining(['fold', 'call', 'raise', 'allin']));
    expect(la.minRaiseTo).toBe(200n); // currentBet 100 + lastFullRaise 100
    expect(la.maxRaiseTo).toBe(1000n); // committed 50 + stack 950
  });

  it('gives the BB the option to check when limped to', () => {
    let st = freshHand([1000n, 1000n], { button: 1 });
    st = play(st, [{ type: 'call', seat: 1 }]).state; // SB completes
    expect(st.toAct).toBe(2); // BB
    const la = legalActions(st, 2);
    expect(la.canCheck).toBe(true);
    expect(la.types).toContain('check');
    expect(la.types).toContain('raise');
  });

  it('min raise grows by the last full raise size', () => {
    let st = freshHand([1000n, 1000n, 1000n], { button: 1 });
    st = play(st, [{ type: 'raise', seat: 1, amount: 300n }]).state; // full raise, incr 200
    const la = legalActions(st, 2);
    expect(la.minRaiseTo).toBe(500n); // currentBet 300 + lastFullRaise 200
  });
});

describe('sub-minimum all-in does NOT reopen for players who already acted', () => {
  it('not-yet-acted seat keeps raise rights; already-acted seat may only call/fold', () => {
    let st = freshHand([1000n, 450n, 1000n], { button: 1 }); // seat2 is the short stack (SB)
    st = play(st, [{ type: 'raise', seat: 1, amount: 300n }]).state; // seat1 full raise (lastFull 200)
    st = play(st, [{ type: 'allin', seat: 2 }]).state; // seat2 all-in to 450 (incr 150 < 200 -> short)
    expect(st.currentBet).toBe(450n);
    expect(st.lastFullRaiseSize).toBe(200n); // unchanged by the short all-in

    // seat 3 has NOT acted yet -> still may raise, min raise = 450 + 200
    const la3 = legalActions(st, 3);
    expect(la3.types).toContain('raise');
    expect(la3.minRaiseTo).toBe(650n);

    st = play(st, [{ type: 'call', seat: 3 }]).state;

    // seat 1 already acted and faces only a short all-in -> no reopen: call/fold only
    const la1 = legalActions(st, 1);
    expect(st.toAct).toBe(1);
    expect(la1.types).toContain('call');
    expect(la1.types).not.toContain('raise');
    expect(la1.types).not.toContain('allin');
  });
});

describe('rejections', () => {
  it('rejects an out-of-turn action', () => {
    const st = freshHand([1000n, 1000n, 1000n], { button: 1 }); // toAct = seat 1
    const r = applyAction(st, { type: 'call', seat: 2 });
    expect(r.error).toMatch(/not your turn/);
    expect(r.state).toBe(st); // unchanged
  });

  it('rejects a duplicate action from a seat that just acted', () => {
    let st = freshHand([1000n, 1000n, 1000n], { button: 1 });
    st = play(st, [{ type: 'call', seat: 1 }]).state; // seat1 acts, turn moves on
    const r = applyAction(st, { type: 'call', seat: 1 });
    expect(r.error).toMatch(/not your turn/);
  });

  it('rejects a check when facing a bet', () => {
    const st = freshHand([1000n, 1000n], { button: 1 }); // SB faces BB
    const r = applyAction(st, { type: 'check', seat: 1 });
    expect(r.error).toMatch(/not legal/);
  });

  it('rejects a raise below the minimum', () => {
    const st = freshHand([1000n, 1000n], { button: 1 });
    const r = applyAction(st, { type: 'raise', seat: 1, amount: 150n }); // min is 200
    expect(r.error).toMatch(/illegal raise size/);
  });
});
