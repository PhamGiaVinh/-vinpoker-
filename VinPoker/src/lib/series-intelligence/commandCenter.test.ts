import { describe, it, expect } from "vitest";
import { mapTournamentToEvent, type NativeTournamentRow, type SeriesEvent } from "./nativeData";
import {
  computeEconomicsSummary,
  computeOwnerActionChecklist,
  computeReadiness,
  computeRiskFlags,
  toEventEconomicsRow,
  type InsightLabel,
} from "./commandCenter";

const ALLOWED_LABELS: InsightLabel[] = ["Known Rule", "Observed Pattern", "Hypothesis"];

/**
 * Build a SeriesEvent via the real adapter so label/missingFields rules stay byte-identical.
 * Uses `key in row` (not `??`) so an EXPLICIT null overrides the default — required to test
 * the missing-field paths (a `??` default would silently revive null back to a value).
 */
function ev(
  row: Partial<NativeTournamentRow>,
  counts?: { totalEntries?: number | null; uniqueEntries?: number | null; reentries?: number | null },
): SeriesEvent {
  const pick = <K extends keyof NativeTournamentRow>(k: K, dflt: NativeTournamentRow[K]): NativeTournamentRow[K] =>
    k in row ? (row[k] as NativeTournamentRow[K]) : dflt;
  const base: NativeTournamentRow = {
    id: pick("id", "t1"),
    name: pick("name", "Event"),
    start_time: pick("start_time", "2026-05-01T11:00:00Z"),
    buy_in: pick("buy_in", 1_000_000),
    rake_amount: pick("rake_amount", 100_000),
    service_fee_amount: pick("service_fee_amount", 0),
    prize_pool: pick("prize_pool", 50_000_000),
    club_id: pick("club_id", "club-A"),
  };
  return mapTournamentToEvent(base, {
    totalEntries: counts?.totalEntries ?? null,
    uniqueEntries: counts?.uniqueEntries ?? null,
    reentries: counts?.reentries ?? null,
  });
}

describe("computeEconomicsSummary", () => {
  it("returns zeroed totals for no events", () => {
    const s = computeEconomicsSummary([]);
    expect(s.events).toBe(0);
    expect(s.totalEntries.value).toBe(0);
    expect(s.totalBuyIn.value).toBe(0);
    expect(s.totalBuyIn.partial).toBe(false);
    expect(s.totalBuyIn.contributingCount).toBe(0);
  });

  it("sums entries/unique/reentries and volumes using entries as denominator", () => {
    const events = [
      ev({ id: "a", buy_in: 1_000_000, rake_amount: 100_000, prize_pool: 30_000_000 }, { totalEntries: 50, uniqueEntries: 40, reentries: 10 }),
      ev({ id: "b", buy_in: 2_000_000, rake_amount: 200_000, prize_pool: 80_000_000 }, { totalEntries: 30, uniqueEntries: 25, reentries: 5 }),
    ];
    const s = computeEconomicsSummary(events);
    expect(s.totalEntries.value).toBe(80);
    expect(s.uniquePlayers.value).toBe(65);
    expect(s.reentries.value).toBe(15);
    expect(s.totalBuyIn.value).toBe(1_000_000 * 50 + 2_000_000 * 30); // 110,000,000
    expect(s.totalRake.value).toBe(100_000 * 50 + 200_000 * 30); // 11,000,000
    expect(s.totalPrizePool.value).toBe(110_000_000);
    expect(s.totalBuyIn.partial).toBe(false);
  });

  it("flags partial totals when a contributing field is missing", () => {
    const events = [
      ev({ id: "a", buy_in: 1_000_000 }, { totalEntries: 50 }),
      ev({ id: "b", buy_in: null }, { totalEntries: 30 }), // no buy_in → excluded from buy-in volume
    ];
    const s = computeEconomicsSummary(events);
    expect(s.totalBuyIn.value).toBe(50_000_000);
    expect(s.totalBuyIn.partial).toBe(true);
    expect(s.totalBuyIn.contributingCount).toBe(1);
    expect(s.totalBuyIn.totalCount).toBe(2);
  });

  it("treats 0 entries as a real contribution, not missing", () => {
    const s = computeEconomicsSummary([ev({ id: "a" }, { totalEntries: 0 })]);
    expect(s.totalEntries.value).toBe(0);
    expect(s.totalEntries.partial).toBe(false);
    expect(s.totalEntries.contributingCount).toBe(1);
  });
});

describe("toEventEconomicsRow", () => {
  it("computes rake yield only when buy_in > 0 and fee present", () => {
    const row = toEventEconomicsRow(ev({ buy_in: 1_000_000, rake_amount: 100_000 }, { totalEntries: 10 }));
    expect(row.rakeYieldPct).toBe(10);
  });
  it("leaves rake yield null when buy_in missing", () => {
    const row = toEventEconomicsRow(ev({ buy_in: null, rake_amount: 100_000 }));
    expect(row.rakeYieldPct).toBeNull();
  });
  it("never invents GTD (always null for native rows)", () => {
    const row = toEventEconomicsRow(ev({}));
    expect(row.gtd).toBeNull();
    expect(row.missingFields).toContain("gtd");
  });
});

describe("computeReadiness", () => {
  it("scores 0 with no events", () => {
    const r = computeReadiness([]);
    expect(r.score).toBe(0);
    expect(r.label).toBe("Observed Pattern");
  });
  it("scores 100 when all core fields present (GTD excluded from score)", () => {
    const events = [ev({ id: "a" }, { totalEntries: 50, uniqueEntries: 40, reentries: 10 })];
    const r = computeReadiness(events);
    expect(r.score).toBe(100);
    expect(r.gtdStructuralGap).toBe(true); // GTD still flagged as a structural gap
    expect(r.missingSummary.some((m) => m.includes("GTD"))).toBe(true);
  });
  it("drops the score and lists missing core fields", () => {
    const events = [
      ev({ id: "a", buy_in: null, prize_pool: null }, { totalEntries: null, uniqueEntries: null, reentries: null }),
    ];
    const r = computeReadiness(events);
    expect(r.score).toBeLessThan(100);
    expect(r.missingSummary.some((m) => m.includes("Buy-in"))).toBe(true);
    expect(r.missingSummary.some((m) => m.includes("entry"))).toBe(true);
  });
});

describe("computeRiskFlags", () => {
  it("returns nothing for no events", () => {
    expect(computeRiskFlags([])).toEqual([]);
  });
  it("always flags GTD missing", () => {
    const flags = computeRiskFlags([ev({ id: "a" }, { totalEntries: 50 })]);
    expect(flags.some((f) => f.id === "gtd-missing")).toBe(true);
  });
  it("flags re-entry dependence when ratio is high", () => {
    const events = [ev({ id: "a" }, { totalEntries: 100, uniqueEntries: 50, reentries: 50 })];
    const flags = computeRiskFlags(events);
    const f = flags.find((x) => x.id === "reentry-dependence");
    expect(f).toBeTruthy();
    expect(f!.label).toBe("Observed Pattern");
  });
  it("flags high buy-in low field as a Hypothesis", () => {
    const events = [
      ev({ id: "a", buy_in: 500_000 }, { totalEntries: 200 }),
      ev({ id: "b", buy_in: 600_000 }, { totalEntries: 180 }),
      ev({ id: "c", buy_in: 5_000_000 }, { totalEntries: 8 }), // high buy-in, low field
    ];
    const flags = computeRiskFlags(events);
    const f = flags.find((x) => x.id === "low-field-high-buyin");
    expect(f).toBeTruthy();
    expect(f!.label).toBe("Hypothesis");
  });
});

describe("computeOwnerActionChecklist", () => {
  it("produces 3–7 actions and always includes GTD verification when GTD missing", () => {
    const events = [ev({ id: "a" }, { totalEntries: 50 })];
    const risks = computeRiskFlags(events);
    const actions = computeOwnerActionChecklist(events, risks);
    expect(actions.length).toBeGreaterThanOrEqual(3);
    expect(actions.length).toBeLessThanOrEqual(7);
    expect(actions.some((a) => a.id === "verify-gtd")).toBe(true);
  });
});

describe("honesty contract — labels never escape the allowed set", () => {
  it("every emitted label is Known Rule / Observed Pattern / Hypothesis (never Model Estimate / Tested Finding)", () => {
    const events = [
      ev({ id: "a", buy_in: 5_000_000 }, { totalEntries: 8, uniqueEntries: 6, reentries: 2 }),
      ev({ id: "b", buy_in: 500_000 }, { totalEntries: 200, uniqueEntries: 120, reentries: 80 }),
      ev({ id: "c", buy_in: 600_000 }, { totalEntries: 5, uniqueEntries: 5, reentries: 0 }),
    ];
    const readiness = computeReadiness(events);
    const risks = computeRiskFlags(events);
    const actions = computeOwnerActionChecklist(events, risks);

    const labels = [readiness.label, ...risks.map((r) => r.label), ...actions.map((a) => a.label)];
    for (const l of labels) {
      expect(ALLOWED_LABELS).toContain(l);
    }
    const serialized = JSON.stringify({ readiness, risks, actions });
    expect(serialized).not.toContain("Model Estimate");
    expect(serialized).not.toContain("Tested Finding");
  });
});
