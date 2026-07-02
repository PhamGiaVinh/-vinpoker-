import { describe, it, expect } from "vitest";
import { mapTournamentToEvent, type NativeTournamentRow, type SeriesEvent } from "./nativeData";
import {
  computeEconomicsSummary,
  computeOwnerActionChecklist,
  computeReadiness,
  computeRiskFlags,
  toEventEconomicsRow,
  computeContributionByType,
  type InsightLabel,
} from "./commandCenter";
import {
  computeScenarioActions,
  computeScenarioConfidence,
  computeScenarioOutlook,
} from "./scenarioOutlook";

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

// ---------------------------------------------------------------------------
// Scenario Outlook Lite (S2) — per-event rules-based scenarios, not prediction.
// ---------------------------------------------------------------------------

/** Build the inputs computeScenarioOutlook expects, from a set of events. */
function outlookOf(events: SeriesEvent[]) {
  const economics = computeEconomicsSummary(events);
  const readiness = computeReadiness(events);
  const risks = computeRiskFlags(events);
  return computeScenarioOutlook(events, economics, readiness, risks);
}

/** N events with entries spread low→high so quantiles are non-degenerate. */
function entrySpread(n: number): SeriesEvent[] {
  return Array.from({ length: n }, (_, i) =>
    ev({ id: `e${i}` }, { totalEntries: 10 + i * 10, uniqueEntries: 8 + i * 8, reentries: 2 + i * 2 }),
  );
}

describe("computeScenarioOutlook", () => {
  it("1. no events → unavailable, empty scenarios", () => {
    const o = outlookOf([]);
    expect(o.available).toBe(false);
    expect(o.scenarios).toEqual([]);
  });

  it("2. GTD missing → every scenario gtdRisk null, no overlay; missing note mentions GTD", () => {
    const o = outlookOf(entrySpread(8));
    expect(o.available).toBe(true);
    for (const s of o.scenarios) expect(s.gtdRisk).toBeNull();
    expect(o.missingDataNotes.some((m) => m.includes("GTD"))).toBe(true);
  });

  it("3. low sample (<4) → confidence low", () => {
    const o = outlookOf(entrySpread(3));
    expect(o.confidence).toBe("low");
  });

  it("4. complete sample (≥8 full-field) → 3 scenarios, available", () => {
    const o = outlookOf(entrySpread(8));
    expect(o.scenarios.map((s) => s.kind)).toEqual(["conservative", "base", "upside"]);
    expect(o.available).toBe(true);
    expect(o.confidence).toBe("high"); // full fields → readiness 100, sample 8
  });

  it("5. deterministic — same input ⇒ identical output", () => {
    const events = entrySpread(6);
    expect(JSON.stringify(outlookOf(events))).toBe(JSON.stringify(outlookOf(events)));
  });

  it("6. entry ranges monotonic: conservative ≤ base ≤ upside (low & high)", () => {
    const [c, b, u] = outlookOf(entrySpread(8)).scenarios;
    expect(c.entryRange.low).toBeLessThanOrEqual(b.entryRange.low);
    expect(b.entryRange.low).toBeLessThanOrEqual(u.entryRange.low);
    expect(c.entryRange.high).toBeLessThanOrEqual(b.entryRange.high);
    expect(b.entryRange.high).toBeLessThanOrEqual(u.entryRange.high);
  });

  it("7. missing buy_in/fee does not crash → those volume ranges are null", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      ev({ id: `e${i}`, buy_in: null, rake_amount: null }, { totalEntries: 20 + i * 10 }),
    );
    const o = outlookOf(events);
    for (const s of o.scenarios) {
      expect(s.buyInVolumeRange).toBeNull();
      expect(s.feeVolumeRange).toBeNull();
    }
  });

  it("8. output never contains Model Estimate / Tested Finding", () => {
    const serialized = JSON.stringify(outlookOf(entrySpread(8)));
    expect(serialized).not.toContain("Model Estimate");
    expect(serialized).not.toContain("Tested Finding");
  });

  it("9. copy carries no positive certainty wording (negated disclaimer allowed)", () => {
    const o = outlookOf(entrySpread(8));
    for (const s of o.scenarios) {
      expect(s.copy).not.toMatch(/đảm bảo|guarantee/i);
      expect(s.copy).not.toContain("chắc chắn"); // copy uses "có thể", never certainty
      expect(s.copy).not.toMatch(/\bsẽ\b/);
    }
    expect(o.disclaimer).toContain("không phải dự đoán chắc chắn"); // negated form is fine
    // every scenario label stays in the allowed set
    for (const s of o.scenarios) expect(ALLOWED_LABELS).toContain(s.insightLabel);
  });

  it("scenario confidence helper honors low-sample rule directly", () => {
    const lowReadiness = computeReadiness(entrySpread(2));
    expect(computeScenarioConfidence(entrySpread(2), lowReadiness)).toBe("low");
  });

  it("scenario actions are labeled and capped (≤5), never empty when scenarios exist", () => {
    const events = entrySpread(8);
    const o = outlookOf(events);
    const actions = computeScenarioActions(o.scenarios, computeRiskFlags(events));
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThanOrEqual(5);
    for (const a of actions) expect(ALLOWED_LABELS).toContain(a.label);
  });
});

describe("computeContributionByType (Biên đóng góp theo loại giải)", () => {
  const cev = (
    name: string,
    over: { buy_in?: number | null; fee?: number | null; entries?: number | null; gtd?: number | null },
  ): SeriesEvent =>
    mapTournamentToEvent(
      {
        id: name,
        name,
        start_time: "2026-05-01T11:00:00Z",
        buy_in: over.buy_in === undefined ? 1_000_000 : over.buy_in,
        rake_amount: over.fee === undefined ? 100_000 : over.fee,
        service_fee_amount: 0,
        prize_pool: null,
        club_id: "club-A",
      },
      { totalEntries: over.entries === undefined ? 100 : over.entries, uniqueEntries: null, reentries: null },
      over.gtd ?? null,
    );

  it("groups by event TYPE and computes fee revenue − observed overlay cost", () => {
    const r = computeContributionByType([
      cev("Main Event", { fee: 200_000, entries: 100, gtd: 80_000_000, buy_in: 1_000_000 }), // overlay 0 (100M ≥ 80M)
      cev("Turbo 500", { fee: 100_000, entries: 50, gtd: 100_000_000, buy_in: 1_000_000 }), // overlay 50M
    ]);
    expect(r.available).toBe(true);
    expect(r.label).toBe("Observed Pattern");
    const main = r.rows.find((x) => x.type === "main")!;
    const turbo = r.rows.find((x) => x.type === "turbo")!;
    expect(main.feeRevenue.value).toBe(200_000 * 100);
    expect(main.overlayCost.value).toBe(0);
    expect(main.margin).toBe(20_000_000);
    expect(turbo.feeRevenue.value).toBe(100_000 * 50);
    expect(turbo.overlayCost.value).toBe(50_000_000);
    expect(turbo.margin).toBe(5_000_000 - 50_000_000); // negative → đỏ
    expect(turbo.margin!).toBeLessThan(0);
  });

  it("buy-in NEVER enters revenue: same fee/entries ⇒ same feeRevenue regardless of buy-in size", () => {
    const small = computeContributionByType([cev("Main A", { buy_in: 1_000_000, fee: 100_000, entries: 100 })]);
    const huge = computeContributionByType([cev("Main B", { buy_in: 500_000_000, fee: 100_000, entries: 100 })]);
    expect(small.rows[0].feeRevenue.value).toBe(huge.rows[0].feeRevenue.value);
    expect(small.rows[0].margin).toBe(huge.rows[0].margin); // no GTD → no overlay path either
  });

  it("missing fee/entries → excluded from revenue with an honest note", () => {
    const r = computeContributionByType([
      cev("Bounty ok", { fee: 100_000, entries: 80 }),
      cev("Bounty broken", { fee: null, entries: 80 }),
    ]);
    const row = r.rows.find((x) => x.type === "bounty")!;
    expect(row.feeRevenue.contributingCount).toBe(1);
    expect(row.feeRevenue.partial).toBe(true);
    expect(row.notes.some((n) => n.includes("thiếu fee"))).toBe(true);
  });

  it("no GTD → no overlay cost charged, counted + noted (never guessed)", () => {
    const r = computeContributionByType([cev("Deepstack", { fee: 100_000, entries: 60, gtd: null })]);
    const row = r.rows.find((x) => x.type === "deepstack")!;
    expect(row.overlayCost.value).toBe(0);
    expect(row.gtdMissingCount).toBe(1);
    expect(row.notes.some((n) => n.includes("không đặt GTD"))).toBe(true);
    expect(row.margin).toBe(100_000 * 60);
  });

  it("empty input → unavailable, no rows", () => {
    const r = computeContributionByType([]);
    expect(r.available).toBe(false);
    expect(r.rows).toHaveLength(0);
  });

  it("rows sorted by margin desc; unmeasurable types (no fee anywhere) sort last with margin null", () => {
    const r = computeContributionByType([
      cev("Turbo win", { fee: 300_000, entries: 100 }),
      cev("Main loss", { fee: 100_000, entries: 10, gtd: 500_000_000, buy_in: 1_000_000 }),
      cev("Mystery broken", { fee: null, entries: null }),
    ]);
    expect(r.rows[0].type).toBe("turbo");
    expect(r.rows[r.rows.length - 1].margin).toBeNull();
  });
});
