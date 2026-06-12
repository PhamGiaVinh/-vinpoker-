// tests/pokerEngine/evaluate.test.ts
// Exhaustive hand-evaluator tests (guardrail 9): wheel, board plays, flush
// kicker, full-house edge, split, straight-flush vs quads, quad kicker.

import { describe, it, expect } from 'vitest';
import { evaluate5, evaluateBest, compareHands, compareRankVec } from '@engine/index.ts';
import type { Card } from '@engine/index.ts';

const cat = (cards: Card[]) => evaluateBest(cards).category;

describe('evaluate5 — category ordering', () => {
  it('orders categories high_card < pair < ... < straight_flush', () => {
    const highCard = evaluate5(['Ah', 'Kd', 'Qs', 'Jc', '9d']);
    const pair = evaluate5(['Ah', 'Ad', 'Qs', 'Jc', '9d']);
    const twoPair = evaluate5(['Ah', 'Ad', 'Qs', 'Qc', '9d']);
    const trips = evaluate5(['Ah', 'Ad', 'Ac', 'Qc', '9d']);
    const straight = evaluate5(['9h', '8d', '7s', '6c', '5d']);
    const flush = evaluate5(['Ah', 'Jh', '9h', '6h', '3h']);
    const full = evaluate5(['Ah', 'Ad', 'Ac', 'Qc', 'Qd']);
    const quads = evaluate5(['Ah', 'Ad', 'Ac', 'As', 'Qd']);
    const sf = evaluate5(['9h', '8h', '7h', '6h', '5h']);
    const ladder = [highCard, pair, twoPair, trips, straight, flush, full, quads, sf];
    for (let i = 1; i < ladder.length; i++) {
      expect(compareRankVec(ladder[i], ladder[i - 1])).toBe(1);
    }
  });
});

describe('evaluate — straights & wheel', () => {
  it('detects the wheel (A-2-3-4-5) as a 5-high straight', () => {
    const wheel = evaluate5(['Ah', '5d', '4c', '3s', '2h']);
    expect(wheel[0]).toBe(4); // straight
    expect(wheel[1]).toBe(5); // 5-high
  });
  it('ranks a 6-high straight above the wheel', () => {
    const wheel = evaluate5(['Ah', '5d', '4c', '3s', '2h']);
    const six = evaluate5(['6c', '5s', '4h', '3d', '2c']);
    expect(compareRankVec(six, wheel)).toBe(1);
  });
  it('a 5-card hand with a pair is NOT a straight', () => {
    expect(evaluate5(['9h', '9d', '7s', '6c', '5d'])[0]).toBe(1); // pair, not straight
  });
});

describe('evaluate — straight flush vs quads', () => {
  it('straight flush beats quad aces', () => {
    const sf: Card[] = ['9h', '8h', '7h', '6h', '5h', '2d', '2c'];
    const quads: Card[] = ['As', 'Ah', 'Ad', 'Ac', 'Kd', '9c', '8d'];
    expect(cat(sf)).toBe(8);
    expect(cat(quads)).toBe(7);
    expect(compareHands(sf, quads)).toBe(1);
  });
});

describe('evaluate — flush kicker', () => {
  it('ace-high flush beats king-high flush on the same suited board', () => {
    const board: Card[] = ['2s', '7s', '9s', 'Jd', '3c'];
    const aHigh: Card[] = ['As', '4s', ...board];
    const kHigh: Card[] = ['Ks', '5s', ...board];
    expect(cat(aHigh)).toBe(5);
    expect(cat(kHigh)).toBe(5);
    expect(compareHands(aHigh, kHigh)).toBe(1);
  });
});

describe('evaluate — full house edge', () => {
  it('aces full of kings beats aces full of fives (compare trips then pair)', () => {
    const board: Card[] = ['Ah', 'Ad', 'As', '5c', '5d'];
    const acesFullKings: Card[] = ['Kh', 'Kd', ...board]; // AAA + KK
    const acesFullFives: Card[] = ['5h', '2c', ...board]; // AAA + 55 (three 5s available)
    expect(cat(acesFullKings)).toBe(6);
    expect(cat(acesFullFives)).toBe(6);
    expect(compareHands(acesFullKings, acesFullFives)).toBe(1);
  });
});

describe('evaluate — quad kicker', () => {
  it('quads with ace kicker beats quads with king kicker', () => {
    const board: Card[] = ['9s', '9h', '9d', '9c', '2d'];
    const aKick: Card[] = ['Ah', '3c', ...board];
    const kKick: Card[] = ['Kh', '3d', ...board];
    expect(compareHands(aKick, kKick)).toBe(1);
  });
});

describe('evaluate — split hands & board plays', () => {
  it('two players who both play the board tie', () => {
    const board: Card[] = ['Ah', 'Kd', 'Qs', 'Jc', 'Td']; // broadway straight on board
    const p1: Card[] = ['2c', '3d', ...board];
    const p2: Card[] = ['2h', '3s', ...board];
    expect(cat(p1)).toBe(4); // straight
    expect(compareHands(p1, p2)).toBe(0);
  });
  it('identical two-pair-by-kickers tie', () => {
    const board: Card[] = ['Ah', 'Kd', 'Qs', '7c', '2d'];
    const p1: Card[] = ['Ac', 'Js', ...board]; // pair AA, kickers K Q J
    const p2: Card[] = ['As', 'Jh', ...board];
    expect(compareHands(p1, p2)).toBe(0);
  });
});

describe('evaluate — high-card kicker chain', () => {
  it('ace-high beats king-high', () => {
    const board: Card[] = ['2c', '5d', '8h', 'Js', '3c'];
    const aHigh: Card[] = ['Ad', 'Qh', ...board];
    const kHigh: Card[] = ['Kc', 'Qd', ...board];
    expect(compareHands(aHigh, kHigh)).toBe(1);
  });
});
