// tests/onlinePoker/handEval.test.ts
// Pure evaluator + exact heads-up equity used by the all-in cinematic (display-only).
import { describe, it, expect } from 'vitest';
import { evaluate5, evaluate7, headsUpEquity } from '@/lib/poker/handEval';

describe('hand evaluator — category ordering', () => {
  it('ranks all 9 categories strictly descending', () => {
    const order = [
      evaluate5(['9h', '8h', '7h', '6h', '5h']), // straight flush
      evaluate5(['9h', '9s', '9d', '9c', '5h']), // quads
      evaluate5(['9h', '9s', '9d', '5c', '5h']), // full house
      evaluate5(['Ah', 'Jh', '9h', '6h', '3h']), // flush
      evaluate5(['9h', '8s', '7d', '6c', '5h']), // straight
      evaluate5(['9h', '9s', '9d', 'Kc', '5h']), // trips
      evaluate5(['9h', '9s', '5d', '5c', 'Kh']), // two pair
      evaluate5(['9h', '9s', 'Kd', '7c', '5h']), // pair
      evaluate5(['Ah', 'Js', '9d', '6c', '3h']), // high card
    ];
    for (let i = 1; i < order.length; i++) expect(order[i - 1]).toBeGreaterThan(order[i]);
  });

  it('wheel A-2-3-4-5 is a straight (5-high), below 6-high straight', () => {
    const wheel = evaluate5(['Ah', '2s', '3d', '4c', '5h']);
    const six = evaluate5(['6h', '2s', '3d', '4c', '5h']);
    expect(wheel).toBeGreaterThan(4e10);   // is a straight
    expect(six).toBeGreaterThan(wheel);    // 6-high beats 5-high
  });

  it('evaluate7 picks the best 5 of 7 (a flush from 7 cards)', () => {
    expect(evaluate7(['Ah', 'Kh', '2h', '7h', '9h', '3s', '4d'])).toBeGreaterThan(5e10);
  });
});

describe('headsUpEquity — exact, real-or-hidden', () => {
  it('returns null PREFLOP (too heavy → hidden, never sampled)', () => {
    expect(headsUpEquity(['As', 'Ks'], ['Qd', 'Qc'], [])).toBeNull();
  });

  it('rejects duplicate cards across hands/board', () => {
    expect(headsUpEquity(['As', 'Ks'], ['As', 'Qc'], ['2h', '7d', '9c'])).toBeNull();
    expect(headsUpEquity(['As', 'Ks'], ['Qd', 'Qc'], ['As', '7d', '9c'])).toBeNull();
  });

  it('rejects malformed input (wrong hole count)', () => {
    expect(headsUpEquity(['As'], ['Qd', 'Qc'], ['2h', '7d', '9c'])).toBeNull();
  });

  it('RIVER is exact 100/0 for the made winner', () => {
    // board 2s Qd Ad 3d 4h; pair of aces (Ac 5d) beats ten-high (8s Tc)
    const eq = headsUpEquity(['Ac', '5d'], ['8s', 'Tc'], ['2s', 'Qd', 'Ad', '3d', '4h']);
    expect(eq).not.toBeNull();
    expect(eq).toEqual({ a: 100, b: 0, tie: 0 });
  });

  it('RIVER split is a 100% tie when both play the board', () => {
    // Broadway straight on board; neither hole card improves it → chop.
    const eq = headsUpEquity(['2c', '3c'], ['2d', '3d'], ['Ts', 'Js', 'Qh', 'Kh', 'Ah']);
    expect(eq).not.toBeNull();
    expect(eq!.tie).toBe(100);
  });

  it('FLOP equity is exact and plausible (flopped set vs two overcards)', () => {
    const eq = headsUpEquity(['9h', '9s'], ['Ah', 'Kd'], ['9c', '4d', '2s']);
    expect(eq).not.toBeNull();
    expect(eq!.a).toBeGreaterThan(85);                 // a set is a huge favourite
    expect(eq!.a + eq!.b + eq!.tie).toBe(100);
  });

  it('TURN equity enumerates the single remaining card exactly', () => {
    const eq = headsUpEquity(['Ac', 'Ad'], ['Kc', 'Kd'], ['2s', '7d', '9c', 'Jh']);
    expect(eq).not.toBeNull();
    expect(eq!.a).toBeGreaterThan(eq!.b);              // aces still ahead
    expect(eq!.a + eq!.b + eq!.tie).toBe(100);
  });
});
