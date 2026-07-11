// A2 — canonical walk-forward artifact (ForecastPoint) + separate scoring layer.
// Locks the P0-2 invariant: the engine's artifact carries NO actuals; a scoring layer joins them.
import { describe, it, expect } from "vitest";
import {
  walkForward,
  scoreForecasts,
  forecastTurnout,
  ENGINE_VERSION,
  type ForecastPoint,
  type UpcomingEvent,
} from "./turnoutForecast";
import type { SeriesEvent } from "./nativeData";

const pad = (n: number) => String(n).padStart(2, "0");
function ev(day: number, buy_in: number, entries: number | null): SeriesEvent {
  return {
    event_id: `evt-${day}`, event_name: "Event", event_date: `2026-01-${pad(day)}T19:00:00+07:00`,
    buy_in, fee: 100_000, serviceFeeAmount: null, gtd: null, prize_pool_actual: null,
    total_entries: entries, unique_entries: entries, reentries: 0, source: "csv", clubId: "c1", missingFields: [],
  };
}
// entries = 2e8 / buy_in (exact log-linear), 12 events across distinct days → distinct event ids.
const buyins = [1_000_000, 2_000_000, 5_000_000];
const EVENTS = Array.from({ length: 12 }, (_, i) => ev(i + 1, buyins[i % 3], Math.round(2e8 / buyins[i % 3])));

describe("A2 walkForward — the canonical artifact", () => {
  const pts = walkForward(EVENTS);

  it("emits one ForecastPoint per fold (rows after CV_MIN_TRAIN=4)", () => {
    expect(pts.length).toBe(12 - 4); // folds i=4..11
    expect(pts.length).toBeGreaterThan(0);
  });

  it("P0-2: the artifact carries NO `actual` (or error) field — engine never sees the target", () => {
    for (const p of pts) {
      expect(p).not.toHaveProperty("actual");
      expect(p).not.toHaveProperty("modelError");
      expect(Object.keys(p).sort()).toEqual(
        ["baseline", "engineVersion", "eventId", "forecast", "horizon", "originTs"].sort(),
      );
    }
  });

  it("each point is well-formed: id, ISO origin, single-step horizon, finite/null forecast+baseline, version", () => {
    for (const p of pts) {
      expect(typeof p.eventId).toBe("string");
      expect(p.originTs).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO
      expect(p.horizon).toBe("event");
      expect(p.engineVersion).toBe(ENGINE_VERSION);
      expect(p.forecast === null || Number.isFinite(p.forecast)).toBe(true);
      expect(p.baseline === null || Number.isFinite(p.baseline)).toBe(true);
    }
  });

  it("deterministic: same events ⇒ identical artifact", () => {
    expect(JSON.stringify(walkForward(EVENTS))).toBe(JSON.stringify(pts));
  });
});

describe("A2 scoreForecasts — the separate join layer", () => {
  const pts = walkForward(EVENTS);
  const actualById = new Map<string, number | null>(EVENTS.map((e) => [e.event_id, e.total_entries]));

  it("joins the later-known actual and computes MAPE contributions per point", () => {
    const scored = scoreForecasts(pts, actualById);
    expect(scored.length).toBe(pts.length);
    for (const s of scored) {
      expect(s.actual).toBe(actualById.get(s.eventId) ?? null);
      if (s.forecast !== null && s.actual) {
        expect(s.modelError).toBeCloseTo(Math.abs(s.forecast - s.actual) / s.actual, 12);
      }
    }
  });

  it("missing actual ⇒ modelError/baselineError null (nothing to score; not a fabricated 0)", () => {
    const scored = scoreForecasts(pts, new Map<string, number | null>()); // no actuals known yet
    for (const s of scored) {
      expect(s.actual).toBeNull();
      expect(s.modelError).toBeNull();
      expect(s.baselineError).toBeNull();
    }
  });

  it("scoring is a pure function of (points, actuals) — does not mutate the artifact", () => {
    const before = JSON.stringify(pts);
    scoreForecasts(pts, actualById);
    expect(JSON.stringify(pts)).toBe(before);
  });

  it("the model beats the median baseline on the exact log-linear fixture (mean MAPE)", () => {
    const scored = scoreForecasts(pts, actualById);
    const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length;
    const m = mean(scored.map((s) => s.modelError).filter((e): e is number => e !== null));
    const b = mean(scored.map((s) => s.baselineError).filter((e): e is number => e !== null));
    expect(m).toBeLessThan(b);
  });
});

// A2 parity guard: the internal CV diagnostic joins actuals POSITIONALLY, not by event_id. event_id is the
// ONLY thing that key touches (artifact id / actual join) — the model, forecast and baseline never read it —
// so relabeling ids must leave modelMapePct/baselineMapePct byte-identical, EVEN when two events collide on
// one id. event_id is not enforced unique (CSV import accepts a user-supplied column with no dedup); an
// id-keyed CV would score the earlier colliding fold against the LATER row's actual and drift from the old
// loop. Positional scoring is immune. This locks the fix for that regression.
describe("A2 — internal CV is invariant to event_id relabeling (positional scoring)", () => {
  // 10 events, distinct days ⇒ distinct dates; entries distinct AND buy-in-driven so a colliding relabel
  // would change what an id-keyed (last-wins) join returns for the earlier fold.
  const bys = [1_000_000, 2_000_000, 5_000_000];
  const BASE: SeriesEvent[] = Array.from({ length: 10 }, (_, i) =>
    ev(i + 1, bys[i % 3], Math.round(2e8 / bys[i % 3]) + i),
  );
  const target: UpcomingEvent = { event_date: "2026-01-15T19:00:00+07:00", buy_in: 2_000_000, gtd: null };

  const base = forecastTurnout(BASE, target);

  it("the fixture actually exercises the CV (non-null MAPEs at n=10 ≥ MIN_FULL)", () => {
    expect(base.sampleSize).toBe(10);
    expect(base.modelMapePct).not.toBeNull();
    expect(base.baselineMapePct).not.toBeNull();
  });

  it("a benign full relabel (fresh distinct ids) changes nothing", () => {
    const relabeled = BASE.map((e, i) => ({ ...e, event_id: `renamed-${i}` }));
    const f = forecastTurnout(relabeled, target);
    expect(f.modelMapePct).toBe(base.modelMapePct);
    expect(f.baselineMapePct).toBe(base.baselineMapePct);
    expect(f.deltaVsBaselinePct).toBe(base.deltaVsBaselinePct);
    expect(f.base).toBe(base.base); // model/forecast never read event_id either
  });

  it("a COLLIDING relabel (mid-fold row shares a later row's id) still matches — id-keyed join would drift", () => {
    // Give the day-6 row (a CV fold, entries≠) the day-10 row's id. A last-wins id map would score the
    // day-6 fold against day-10's actual; positional scoring keeps day-6's own actual.
    const collided = BASE.map((e) => ({ ...e }));
    collided[5].event_id = collided[9].event_id;
    const f = forecastTurnout(collided, target);
    expect(f.modelMapePct).toBe(base.modelMapePct);
    expect(f.baselineMapePct).toBe(base.baselineMapePct);
    expect(f.deltaVsBaselinePct).toBe(base.deltaVsBaselinePct);
  });
});

// sanity: exported type is usable
const _typecheck: ForecastPoint | null = null;
void _typecheck;
