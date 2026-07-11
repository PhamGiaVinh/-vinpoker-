// A5 — Engine shape & parity locks (Series Intelligence quant-apply plan, Đợt 1 bước 1).
//
// PURPOSE: lock the CURRENT behavior of the three SI engines BEFORE the A2/A1/A4a refactors, so every
// later step must prove parity against these tests. Additive only — no engine file is touched.
//
// TOLERANCE POLICY (thành văn, per review):
//   • Engines are deterministic (seeded mulberry32 PRNG, closed-form ridge) → fixtures compare EXACT
//     values (JSON equality / vitest snapshots). No rtol fudge: same input + same seed = same bytes.
//   • An INTENTIONAL behavior change must update the snapshot in the SAME PR, state the reason in the
//     PR body, and pass parity review. A snapshot diff with no stated reason = regression, reject.
//   • Degenerate-case tests lock what the engine DOES today (usable:false shapes, filters, zero-GTD),
//     not what it "should" do — behavior changes belong to A4b behind its flag, never here.
import { describe, it, expect } from "vitest";
import { simulateOverlayRisk, simulateOverlayFromForecast, type OverlayRiskInput } from "./overlayRiskEngine";
import { forecastTurnout, type UpcomingEvent } from "./turnoutForecast";
import { computeWithinSeriesElasticity } from "./withinSeries";
import type { SeriesEvent } from "./nativeData";

// ---------- shared fixtures (local copies — no cross-test-file imports) ----------
const pad = (n: number) => String(n).padStart(2, "0");
function ev(day: number, buy_in: number, entries: number | null, extra: Partial<SeriesEvent> = {}): SeriesEvent {
  return {
    event_id: `e-${day}-${buy_in}`,
    event_name: "Event",
    event_date: `2026-01-${pad(day)}T19:00:00+07:00`,
    buy_in,
    fee: 100_000,
    serviceFeeAmount: null,
    gtd: null,
    prize_pool_actual: null,
    total_entries: entries,
    unique_entries: entries,
    reentries: 0,
    source: "csv",
    clubId: "c1",
    missingFields: [],
    ...extra,
  };
}
function exactSet(days: number[]): SeriesEvent[] {
  const buyins = [1_000_000, 2_000_000, 5_000_000];
  return days.map((d, i) => ev(d, buyins[i % buyins.length], Math.round(2e8 / buyins[i % buyins.length])));
}
const HIST: OverlayRiskInput = {
  observedEntries: [795, 2350], buyinPrize: 31_428_571, fee: 4_571_428,
  gtd: 25e9, n: 2, sd: 0.55, nSims: 20000, seed: 42,
};
const FC = { baseEntries: 180, logSd: 0.45, buyinPrize: 3_000_000, fee: 300_000, gtd: 600_000_000, seed: 7, nSims: 20000 };
const FUTURE: UpcomingEvent = { event_date: "2026-02-15T19:00:00+07:00", buy_in: 1_000_000, gtd: null };

const deepFreeze = <T,>(o: T): T => {
  if (o && typeof o === "object") {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};
const allFinite = (r: object): boolean =>
  Object.values(r).every((v) =>
    typeof v === "number" ? Number.isFinite(v) : Array.isArray(v) ? v.every((b) => typeof b !== "number" || Number.isFinite(b)) : true,
  );

// ================= simulateOverlayRisk (two-layer history engine) =================
describe("A5 shape — simulateOverlayRisk", () => {
  it("seed determinism: same input + seed ⇒ byte-identical; different seed ⇒ different", () => {
    expect(JSON.stringify(simulateOverlayRisk(HIST))).toBe(JSON.stringify(simulateOverlayRisk(HIST)));
    expect(JSON.stringify(simulateOverlayRisk({ ...HIST, seed: 43 }))).not.toBe(JSON.stringify(simulateOverlayRisk(HIST)));
  });

  it("never mutates its input (frozen input runs clean; array unchanged)", () => {
    const obs = [795, 2350];
    const input = deepFreeze({ ...HIST, observedEntries: obs });
    const r = simulateOverlayRisk(input as OverlayRiskInput);
    expect(r.usable).toBe(true);
    expect(obs).toEqual([795, 2350]);
  });

  it("quantile monotonicity + probability bounds + all-finite", () => {
    const r = simulateOverlayRisk(HIST);
    expect(r.entP5).toBeLessThanOrEqual(r.entP50);
    expect(r.entP50).toBeLessThanOrEqual(r.entP95);
    expect(r.rakeP5).toBeLessThanOrEqual(r.rakeP95);
    expect(r.pOverlay).toBeGreaterThanOrEqual(0);
    expect(r.pOverlay).toBeLessThanOrEqual(1);
    expect(r.eOverlay).toBeGreaterThanOrEqual(0);
    expect(allFinite(r)).toBe(true);
    expect(r.bins.length).toBeGreaterThan(0);
  });

  it("degenerate: no valid observations OR buyin<=0 ⇒ usable:false zero-shape (current contract)", () => {
    for (const bad of [
      { ...HIST, observedEntries: [] },
      { ...HIST, observedEntries: [-5, Number.NaN, 0] },
      { ...HIST, buyinPrize: 0 },
    ]) {
      const r = simulateOverlayRisk(bad as OverlayRiskInput);
      expect(r.usable).toBe(false);
      expect(r.pOverlay).toBe(0);
      expect(r.eOverlay).toBe(0);
      expect(r.bins).toEqual([]);
    }
  });

  it("invalid observations are FILTERED, not fatal: junk-padded input ≡ clean input", () => {
    const clean = simulateOverlayRisk({ ...HIST, observedEntries: [795, 2350] });
    const dirty = simulateOverlayRisk({ ...HIST, observedEntries: [-1, Number.NaN, 795, 0, 2350] });
    expect(JSON.stringify(dirty)).toBe(JSON.stringify(clean));
  });

  it("degenerate: gtd=0 ⇒ usable but zero overlay (prize can never undershoot a zero guarantee)", () => {
    const r = simulateOverlayRisk({ ...HIST, gtd: 0 });
    expect(r.usable).toBe(true);
    expect(r.pOverlay).toBe(0);
    expect(r.eOverlay).toBe(0);
  });

  it("extreme inputs stay finite: single observation, n=1, huge sd", () => {
    const r = simulateOverlayRisk({ ...HIST, observedEntries: [300], n: 1, sd: 5 });
    expect(r.usable).toBe(true);
    expect(allFinite(r)).toBe(true);
    expect(r.entP5).toBeLessThanOrEqual(r.entP95);
  });

  it("PARITY FIXTURE — canonical history input (exact snapshot; see tolerance policy)", () => {
    expect(simulateOverlayRisk(HIST)).toMatchSnapshot();
  });
});

// ================= simulateOverlayFromForecast (forecast-centered adapter) =================
describe("A5 shape — simulateOverlayFromForecast", () => {
  it("seed determinism + different-seed divergence", () => {
    expect(JSON.stringify(simulateOverlayFromForecast(FC))).toBe(JSON.stringify(simulateOverlayFromForecast(FC)));
    expect(JSON.stringify(simulateOverlayFromForecast({ ...FC, seed: 8 }))).not.toBe(JSON.stringify(simulateOverlayFromForecast(FC)));
  });

  it("never mutates its (frozen) input", () => {
    const input = deepFreeze({ ...FC });
    expect(simulateOverlayFromForecast(input).usable).toBe(true);
  });

  it("quantile monotonicity + bounds + all-finite", () => {
    const r = simulateOverlayFromForecast(FC);
    expect(r.entP5).toBeLessThanOrEqual(r.entP50);
    expect(r.entP50).toBeLessThanOrEqual(r.entP95);
    expect(r.rakeP5).toBeLessThanOrEqual(r.rakeP95);
    expect(r.pOverlay).toBeGreaterThanOrEqual(0);
    expect(r.pOverlay).toBeLessThanOrEqual(1);
    expect(allFinite(r)).toBe(true);
  });

  it("degenerate: baseEntries<=0 / logSd<=0 / buyin<=0 ⇒ usable:false zero-shape (current contract)", () => {
    for (const bad of [{ ...FC, baseEntries: 0 }, { ...FC, logSd: 0 }, { ...FC, buyinPrize: 0 }]) {
      const r = simulateOverlayFromForecast(bad);
      expect(r.usable).toBe(false);
      expect(r.bins).toEqual([]);
    }
  });

  it("PARITY FIXTURES — lognormal path and NegBin small-field path (exact snapshots)", () => {
    expect(simulateOverlayFromForecast(FC)).toMatchSnapshot();
    expect(
      simulateOverlayFromForecast({ baseEntries: 40, logSd: 0.45, buyinPrize: 1_000_000, fee: 100_000, gtd: 55_000_000, seed: 77, nSims: 12000, smallFieldDist: true }),
    ).toMatchSnapshot();
  });
});

// ================= forecastTurnout (ridge log-linear) =================
describe("A5 shape — forecastTurnout", () => {
  it("never mutates the events array or its rows (frozen input runs clean)", () => {
    const events = exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const copy = JSON.parse(JSON.stringify(events));
    deepFreeze(events);
    const r = forecastTurnout(events, FUTURE);
    expect(r.available).toBe(true);
    expect(events).toEqual(copy);
  });

  it("degenerate: constant series (same entries, same buy-in) stays finite — locks the std-guard", () => {
    const events = Array.from({ length: 8 }, (_, i) => ev(i + 1, 1_000_000, 100));
    const r = forecastTurnout(events, FUTURE);
    expect(r.available).toBe(true);
    expect(Number.isFinite(r.base!)).toBe(true);
    expect(Number.isFinite(r.low!) && Number.isFinite(r.high!)).toBe(true);
    expect(r.low!).toBeLessThanOrEqual(r.high!);
    expect(r.coefContributions.every((c) => Number.isFinite(c.beta) && Number.isFinite(c.impactPct))).toBe(true);
  });

  it("band ordering always holds: low ≤ base ≤ high", () => {
    const r = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), FUTURE);
    expect(r.low!).toBeLessThanOrEqual(r.base!);
    expect(r.base!).toBeLessThanOrEqual(r.high!);
  });

  it("PARITY FIXTURE — canonical 12-event fixture, default options (exact snapshot)", () => {
    expect(forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), FUTURE)).toMatchSnapshot();
  });
});

// ================= computeWithinSeriesElasticity (per-brand OLS) =================
describe("A5 shape — computeWithinSeriesElasticity", () => {
  const brand = (name: string): SeriesEvent[] => {
    // 6 editions, non-monotone buy-ins (price not collinear with edition), planar entries.
    // Intercept anchored at buy-in=1M so entries are realistic integers (~300+), not sub-1 fractions
    // that Math.round would zero out (the classic planar-fixture trap — rows with entries=0 get filtered).
    const buyins = [1_000_000, 2_000_000, 3_000_000, 1_000_000, 2_000_000, 3_000_000];
    const c = Math.log(300) + 0.8 * Math.log(1_000_000);
    return buyins.map((b, i) =>
      ev(i + 1, b, Math.round(Math.exp(c - 0.8 * Math.log(b) + 0.15 * (i + 1))), {
        event_name: name, event_date: `2026-${pad(i + 1)}-05T19:00:00+07:00`,
      }),
    );
  };

  it("never mutates its (frozen) input", () => {
    const events = brand("APT Main");
    const copy = JSON.parse(JSON.stringify(events));
    deepFreeze(events);
    const r = computeWithinSeriesElasticity(events);
    expect(r.enough).toBe(true);
    expect(events).toEqual(copy);
  });

  it("empty input ⇒ calm empty result (no throw, no NaN)", () => {
    const r = computeWithinSeriesElasticity([]);
    expect(r.enough).toBe(false);
    expect(r.perBrand).toEqual([]);
    expect(r.pooledGamma).toBeNull();
  });

  it("PARITY FIXTURE — canonical planar brand (exact snapshot)", () => {
    expect(computeWithinSeriesElasticity(brand("APT Main"))).toMatchSnapshot();
  });
});
