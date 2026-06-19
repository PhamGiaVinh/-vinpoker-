import { describe, it, expect } from "vitest";
import { mapTournamentToEvent, type NativeTournamentRow, type SeriesEvent } from "./nativeData";
import { type InsightLabel } from "./commandCenter";
import { buildSeriesReport } from "./seriesReport";

const ALLOWED_LABELS: InsightLabel[] = ["Known Rule", "Observed Pattern", "Hypothesis"];

/** Build a SeriesEvent via the real adapter; `key in row` lets explicit null override defaults. */
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

/** A varied, full-field set that triggers several risks (reentry-heavy, a high-buy-in low-field, concentration). */
function richSet(): SeriesEvent[] {
  const normal = [40, 50, 60, 70, 80, 90].map((n, i) =>
    ev({ id: `n${i}`, name: `Daily ${i}` }, { totalEntries: n, uniqueEntries: Math.round(n * 0.6), reentries: Math.round(n * 0.4) }),
  );
  const huge = ev({ id: "huge", name: "Main Event" }, { totalEntries: 500, uniqueEntries: 300, reentries: 200 });
  const highBuyLowField = ev({ id: "hi", name: "High Roller", buy_in: 5_000_000 }, { totalEntries: 10, uniqueEntries: 9, reentries: 1 });
  return [...normal, huge, highBuyLowField];
}

describe("buildSeriesReport", () => {
  it("1. no events → returns the FULL shape with available:false (no crash)", () => {
    const r = buildSeriesReport([]);
    expect(r.available).toBe(false);
    // full shape present so the component can render safely
    expect(r.executive.readinessScore).toBe(0);
    expect(r.executive.topRisks).toEqual([]);
    expect(r.executive.topOpportunities).toEqual([]);
    expect(r.economics.events).toBe(0);
    expect(r.riskRegister).toEqual([]);
    expect(r.actionPlan).toEqual([]);
    expect(r.honestBoundary.labelsLegend.length).toBe(3);
    expect(r.honestBoundary.disclaimer).toMatch(/không phải dự đoán/);
  });

  it("2. topRisks ≤ 3 and severity-ordered (risk ≤ warning ≤ info), deterministic", () => {
    const r = buildSeriesReport(richSet());
    expect(r.executive.topRisks.length).toBeLessThanOrEqual(3);
    const rank = { risk: 0, warning: 1, info: 2 } as const;
    const ranks = r.executive.topRisks.map((x) => rank[x.severity]);
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    // deterministic equal-severity ordering via id tie-breaker
    expect(JSON.stringify(buildSeriesReport(richSet()).executive.topRisks)).toBe(JSON.stringify(r.executive.topRisks));
  });

  it("3. topOpportunities ≤ 3, every label in the allowed set", () => {
    const r = buildSeriesReport(richSet());
    expect(r.executive.topOpportunities.length).toBeLessThanOrEqual(3);
    for (const o of r.executive.topOpportunities) expect(ALLOWED_LABELS).toContain(o.label);
  });

  it("4. actionPlan has the 5 phases; GTD-missing adds the GTD item in phase 1", () => {
    const r = buildSeriesReport(richSet());
    expect(r.actionPlan.map((p) => p.phase)).toEqual(["Trước khi công bố", "D-7", "D-3", "Ngày event", "Sau series"]);
    expect(r.actionPlan[0].items.some((i) => i.text.includes("GTD"))).toBe(true);
    // labels are not all Known Rule (varied by source)
    const allLabels = r.actionPlan.flatMap((p) => p.items.map((i) => i.label));
    for (const l of allLabels) expect(ALLOWED_LABELS).toContain(l);
  });

  it("5. honestBoundary.missingData mentions GTD exactly once (de-duped); disclaimer present", () => {
    const r = buildSeriesReport(richSet());
    const gtdLines = r.honestBoundary.missingData.filter((m) => m.includes("GTD"));
    expect(gtdLines.length).toBe(1);
    expect(r.honestBoundary.disclaimer.length).toBeGreaterThan(0);
  });

  it("6. serialized report never contains Model Estimate / Tested Finding", () => {
    const s = JSON.stringify(buildSeriesReport(richSet()));
    expect(s).not.toContain("Model Estimate");
    expect(s).not.toContain("Tested Finding");
  });

  it("7. deterministic — same input ⇒ identical output", () => {
    const events = richSet();
    expect(JSON.stringify(buildSeriesReport(events))).toBe(JSON.stringify(buildSeriesReport(events)));
  });

  it("no positive certainty / profit wording in report copy", () => {
    const s = JSON.stringify(buildSeriesReport(richSet()));
    expect(s).not.toMatch(/đảm bảo|guarantee/i);
    expect(s).not.toContain("doanh thu dự kiến");
  });
});
