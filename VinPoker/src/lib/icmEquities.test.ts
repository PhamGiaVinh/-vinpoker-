import { describe, expect, it } from "vitest";
import { icmEquities } from "./icmEquities";

describe("standalone ICM calculator", () => {
  it("matches the two-player result", () => {
    expect(icmEquities([3000, 1000], [70, 30])).toEqual([60, 40]);
  });

  it("handles 15 players without enumerating 15! orders and conserves the prize total", () => {
    const result = icmEquities(Array(15).fill(1000), [150, 75, 30, ...Array(12).fill(0)]);
    expect(result).toHaveLength(15);
    for (const equity of result) expect(equity).toBeCloseTo(17, 8);
    expect(result.reduce((sum, equity) => sum + equity, 0)).toBeCloseTo(255, 8);
  });

  it.each(Array.from({ length: 14 }, (_, i) => i + 2))("conserves prizes for %i unequal stacks", n => {
    const stacks = Array.from({ length: n }, (_, i) => (i + 1) * 1000);
    const prizes = Array.from({ length: n }, (_, i) => (n - i) * 100);
    const result = icmEquities(stacks, prizes);
    expect(result.every(x => Number.isFinite(x) && x >= 0)).toBe(true);
    expect(result.reduce((sum, x) => sum + x, 0)).toBeCloseTo(prizes.reduce((sum, x) => sum + x, 0), 6);
    for (let i = 1; i < n; i++) expect(result[i]).toBeGreaterThan(result[i - 1]);
  });

  it("is stable for subnormal stacks and invariant to stack scale", () => {
    const normal = icmEquities(Array(15).fill(1), [150, 75, 30, ...Array(12).fill(0)]);
    const tiny = icmEquities(Array(15).fill(Number.MIN_VALUE), [150, 75, 30, ...Array(12).fill(0)]);
    tiny.forEach((value, index) => expect(value).toBeCloseTo(normal[index], 8));
  });

  it("matches explicit enumeration for a small uneven field", () => {
    const chips = [9, 7, 5, 3, 2];
    const prizes = [100, 55, 20, 0, 0];
    const expected = chips.map(() => 0);
    const visit = (remaining: number[], place: number, probability: number) => {
      const total = remaining.reduce((sum, i) => sum + chips[i], 0);
      for (const i of remaining) {
        const next = probability * chips[i] / total;
        expected[i] += next * prizes[place];
        visit(remaining.filter(x => x !== i), place + 1, next);
      }
    };
    visit([0, 1, 2, 3, 4], 0, 1);
    icmEquities(chips, prizes).forEach((value, i) => expect(value).toBeCloseTo(expected[i], 10));
  });

  it.each([
    [[99, 1], [100, -50]],
    [[Infinity, 1], [100, 0]],
    [[1, 1], [Infinity, 0]],
    [[1, 0], [100, 0]],
    [[1, 1], [0, 0]],
    [[1, 1], [100]],
    [[NaN, 1], [100, 0]],
    [[Number.MAX_VALUE, Number.MAX_VALUE], [100, 0]],
    [[1, 1], [Number.MAX_VALUE, Number.MAX_VALUE]],
    [Array(2), [100, 0]],
    [[1, 1], Array(2)],
    [[1], [100]],
    [Array(16).fill(1), Array(16).fill(100)],
  ])("rejects invalid stacks or prizes", (chips, prizes) => {
    expect(() => icmEquities(chips, prizes)).toThrow(RangeError);
  });
});
