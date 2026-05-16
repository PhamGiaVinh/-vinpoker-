import { describe, it, expect } from "vitest";
import {
  mean,
  sampleSD,
  confidenceInterval,
  riskOfRuin,
  recommendedBankroll,
  maxDownswing,
  entryNetPL,
  computeSummary,
  type BankrollEntry,
} from "@/lib/bankrollMath";

const mkTour = (over: Partial<BankrollEntry> = {}): BankrollEntry => ({
  id: crypto.randomUUID(),
  user_id: "u1",
  entry_date: "2026-01-01",
  game_type: "tournament",
  buyin: 100,
  rake: 0,
  prize_won: 0,
  entries: 1,
  stakes: null,
  hours: null,
  profit_loss: null,
  notes: null,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const mkCash = (pl: number): BankrollEntry =>
  mkTour({
    game_type: "cash",
    buyin: null,
    rake: null,
    prize_won: null,
    entries: null,
    profit_loss: pl,
  });

describe("mean", () => {
  it("returns 0 for empty array", () => expect(mean([])).toBe(0));
  it("computes arithmetic mean", () =>
    expect(mean([1, 2, 3, 4, 5])).toBeCloseTo(3));
  it("works with negatives", () =>
    expect(mean([-10, 0, 10])).toBeCloseTo(0));
});

describe("sampleSD", () => {
  it("returns 0 for empty array", () => expect(sampleSD([])).toBe(0));
  it("returns 0 for single entry", () => expect(sampleSD([42])).toBe(0));
  it("returns 0 when all values equal", () =>
    expect(sampleSD([5, 5, 5, 5])).toBe(0));
  it("matches known value", () => {
    // sample SD of [2,4,4,4,5,5,7,9] = ~2.138
    expect(sampleSD([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });
});

describe("confidenceInterval", () => {
  it("returns {0,0} for n=0", () =>
    expect(confidenceInterval(100, 50, 0)).toEqual({ low: 0, high: 0 }));
  it("is symmetric around the mean", () => {
    const ci = confidenceInterval(100, 20, 25);
    expect(ci.low + ci.high).toBeCloseTo(200, 5);
  });
  it("shrinks as n grows", () => {
    const small = confidenceInterval(0, 100, 4);
    const large = confidenceInterval(0, 100, 400);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });
});

describe("riskOfRuin", () => {
  it("returns 1 if winrate <= 0", () =>
    expect(riskOfRuin(0, 100, 1000)).toBe(1));
  it("returns 1 if sd <= 0", () =>
    expect(riskOfRuin(10, 0, 1000)).toBe(1));
  it("returns 1 if bankroll <= 0", () =>
    expect(riskOfRuin(10, 100, 0)).toBe(1));
  it("output stays within [0,1]", () => {
    const r = riskOfRuin(5, 80, 500);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });
  it("approaches 0 with very large bankroll", () => {
    expect(riskOfRuin(10, 50, 1_000_000)).toBeLessThan(0.0001);
  });
});

describe("recommendedBankroll", () => {
  it("returns 0 if winrate <= 0", () =>
    expect(recommendedBankroll(100, 0)).toBe(0));
  it("returns 0 if sd <= 0", () =>
    expect(recommendedBankroll(0, 10)).toBe(0));
  it("grows with sd", () => {
    expect(recommendedBankroll(200, 10)).toBeGreaterThan(
      recommendedBankroll(100, 10),
    );
  });
  it("matches formula -ln(0.05)*sd^2/(2*wr)", () => {
    const sd = 100;
    const wr = 5;
    const expected = (-Math.log(0.05) * sd * sd) / (2 * wr);
    expect(recommendedBankroll(sd, wr, 0.05)).toBeCloseTo(expected, 6);
  });
});

describe("maxDownswing", () => {
  it("returns 0 if winrate <= 0", () =>
    expect(maxDownswing(100, 0)).toBe(0));
  it("returns 0 if sd <= 0", () =>
    expect(maxDownswing(0, 5)).toBe(0));
  it("grows with sd squared", () => {
    const a = maxDownswing(50, 5);
    const b = maxDownswing(100, 5);
    expect(b / a).toBeCloseTo(4, 1);
  });
});

describe("entryNetPL", () => {
  it("tournament: prize - buyin*entries - rake", () => {
    expect(
      entryNetPL(mkTour({ buyin: 100, rake: 10, prize_won: 500, entries: 3 })),
    ).toBe(500 - 300 - 10);
  });
  it("cash uses profit_loss directly", () => {
    expect(entryNetPL(mkCash(-250))).toBe(-250);
    expect(entryNetPL(mkCash(425))).toBe(425);
  });
  it("treats null fields as 0 / 1 entry", () => {
    expect(
      entryNetPL(
        mkTour({ buyin: null, rake: null, prize_won: null, entries: null }),
      ),
    ).toBe(0);
  });
});

describe("computeSummary (ROI, ITM)", () => {
  it("empty list → all zeros, no NaN", () => {
    const s = computeSummary([], 1000);
    expect(s.n).toBe(0);
    expect(s.totalPL).toBe(0);
    expect(s.currentBR).toBe(1000);
    expect(s.roi).toBe(0);
    expect(s.itm).toBe(0);
    expect(s.cashes).toBe(0);
    expect(s.winrate).toBe(0);
    expect(s.sd).toBe(0);
    expect(Number.isNaN(s.roi)).toBe(false);
  });

  it("all losses → ROI = -100, ITM = 0", () => {
    const entries = [
      mkTour({ buyin: 100, prize_won: 0 }),
      mkTour({ buyin: 200, prize_won: 0 }),
      mkTour({ buyin: 300, prize_won: 0 }),
    ];
    const s = computeSummary(entries, 1000);
    expect(s.roi).toBeCloseTo(-100, 5);
    expect(s.itm).toBe(0);
    expect(s.cashes).toBe(0);
  });

  it("all wins → ROI > 0, ITM = 100", () => {
    const entries = [
      mkTour({ buyin: 100, prize_won: 300 }),
      mkTour({ buyin: 100, prize_won: 250 }),
    ];
    const s = computeSummary(entries, 0);
    expect(s.itm).toBe(100);
    expect(s.cashes).toBe(2);
    expect(s.roi).toBeGreaterThan(0);
    // (550 - 200)/200 * 100 = 175
    expect(s.roi).toBeCloseTo(175, 5);
  });

  it("single tournament entry → SD = 0 but ROI valid", () => {
    const s = computeSummary([mkTour({ buyin: 100, prize_won: 250 })], 0);
    expect(s.sd).toBe(0);
    expect(s.roi).toBeCloseTo(150, 5);
    expect(s.itm).toBe(100);
  });

  it("mix of tournament + cash → ITM/ROI computed only on tournaments", () => {
    const entries = [
      mkTour({ buyin: 100, prize_won: 200 }), // +100 tour
      mkTour({ buyin: 100, prize_won: 0 }), // -100 tour
      mkCash(50), // cash
      mkCash(-30), // cash
    ];
    const s = computeSummary(entries, 1000);
    expect(s.n).toBe(4);
    expect(s.totalPL).toBe(100 - 100 + 50 - 30); // 20
    expect(s.currentBR).toBe(1020);
    expect(s.itm).toBe(50); // 1 of 2 tourneys cashed
    // roi = (200 - 200) / 200 * 100 = 0
    expect(s.roi).toBeCloseTo(0, 5);
  });
});
