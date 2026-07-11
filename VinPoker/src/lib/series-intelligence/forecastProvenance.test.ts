// B2 — structured forecast provenance. Locks the identity contract: predictor-vs-input split, historical
// training outcome changes the hash but the target's own outcome / future events do not, model-consumed data
// only (not UI labels), timezone-normalized timing, completeness, determinism, no mutation.
import { describe, it, expect } from "vitest";
import { buildForecastProvenance } from "./forecastProvenance";
import { ENGINE_VERSION, type UpcomingEvent, type ForecastOptions } from "./turnoutForecast";
import { FEATURE_SCHEMA_VERSION } from "./featureBoundary";
import type { SeriesEvent } from "./nativeData";

const pad = (n: number) => String(n).padStart(2, "0");
function ev(day: number, buy_in: number, entries: number, name = "Event"): SeriesEvent {
  return {
    event_id: `e-${day}`, event_name: name, event_date: `2026-01-${pad(day)}T19:00:00+07:00`,
    buy_in, fee: 100_000, serviceFeeAmount: null, gtd: null, prize_pool_actual: null,
    total_entries: entries, unique_entries: entries, reentries: 0, source: "csv", clubId: "c1", missingFields: [],
  };
}
const bys = [1_000_000, 2_000_000, 5_000_000];
const EVENTS = Array.from({ length: 8 }, (_, i) => ev(i + 1, bys[i % 3], 100 + i * 7));
const TARGET: UpcomingEvent = { event_date: "2026-02-15T19:00:00+07:00", buy_in: 2_000_000, gtd: null };
const TIMING = {
  forecastIssuedAt: "2026-02-10T10:00:00+07:00",
  asOfTs: "2026-02-10T10:00:00+07:00",
  targetEventTs: "2026-02-15T19:00:00+07:00",
};
const clone = (e: SeriesEvent[]) => e.map((x) => ({ ...x }));
const build = (events = EVENTS, target = TARGET, opts: ForecastOptions = {}, meta = {}) =>
  buildForecastProvenance(events, target, opts, TIMING, meta);

describe("B2 provenance — shape & completeness", () => {
  it("stamps engine/feature-schema identity + a full hash set", async () => {
    const p = await build();
    expect(p.predictor.engineVersion).toBe(ENGINE_VERSION);
    expect(p.predictor.featureSchemaVersion).toBe(FEATURE_SCHEMA_VERSION);
    expect(p.predictor.trialCount).toBe(1);
    for (const h of [p.input.predictorId, p.input.targetInputHash, p.input.trainingDataHash, p.input.canonicalInputHash]) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(p.timing.asOfTs.endsWith("Z")).toBe(true); // normalized to UTC
  });
  it("completeness: default codeSha 'unknown' ⇒ missing_code_sha; provided ⇒ complete; manual ⇒ manual", async () => {
    expect((await build()).completeness).toBe("missing_code_sha");
    expect((await build(EVENTS, TARGET, {}, { codeSha: "abc123" })).completeness).toBe("complete");
    expect((await build(EVENTS, TARGET, {}, { kind: "manual" })).completeness).toBe("manual");
  });
});

describe("B2 predictor identity (B1 pools by this)", () => {
  it("is STABLE across different targets with the same engine/config", async () => {
    const a = await build(EVENTS, TARGET);
    const b = await build(EVENTS, { event_date: "2026-03-20T12:00:00+07:00", buy_in: 5_000_000, gtd: 200_000_000 });
    expect(a.input.predictorId).toBe(b.input.predictorId); // same predictor
    expect(a.input.canonicalInputHash).not.toBe(b.input.canonicalInputHash); // different forecast
  });
  it("changes when the model config changes (calendarFeatures on/off)", async () => {
    const off = await build(EVENTS, TARGET, {});
    const on = await build(EVENTS, TARGET, { calendarFeatures: true });
    expect(on.predictor.modelConfigHash).not.toBe(off.predictor.modelConfigHash);
    expect(on.input.predictorId).not.toBe(off.input.predictorId);
  });
});

describe("B2 input identity — what changes the hash (P0-3, P0-4)", () => {
  it("a HISTORICAL training row's entries changes trainingDataHash, NOT predictorId", async () => {
    const base = await build();
    const mut = clone(EVENTS);
    mut[2].total_entries = (mut[2].total_entries ?? 0) + 999;
    const after = await build(mut);
    expect(after.input.trainingDataHash).not.toBe(base.input.trainingDataHash);
    expect(after.input.canonicalInputHash).not.toBe(base.input.canonicalInputHash);
    expect(after.input.predictorId).toBe(base.input.predictorId); // predictor unchanged
  });
  it("a FUTURE event (after the target) does NOT change identity — it is not a training row", async () => {
    const base = await build();
    const future: SeriesEvent = { ...ev(9, 3_000_000, 400, "Future"), event_id: "future", event_date: "2026-03-01T19:00:00+07:00" };
    const withFuture = await build([...EVENTS, future]);
    expect(withFuture.input.canonicalInputHash).toBe(base.input.canonicalInputHash);
  });
  it("renaming a display-only event_name does NOT change identity when calendar features are OFF (P0-4)", async () => {
    const base = await build(EVENTS, TARGET, {});
    const renamed = clone(EVENTS);
    renamed[0].event_name = "Totally Different Display Name";
    expect((await build(renamed, TARGET, {})).input.canonicalInputHash).toBe(base.input.canonicalInputHash);
  });
  it("renaming a brand DOES change identity when the name is consumed as a feature (calendar ON, editionTrend)", async () => {
    // With calendar features ON the brand name feeds editionTrend, so a brand rename is a real input change —
    // demonstrating the name is only hashed when the model consumes it (the inverse of the display-only case).
    const repeated = [
      ev(1, 1e6, 100, "Main"), ev(2, 1e6, 110, "Main"), ev(3, 1e6, 120, "Side"), ev(4, 1e6, 130, "Main"),
      ev(5, 1e6, 140, "Main"), ev(6, 1e6, 150, "Side"), ev(7, 1e6, 160, "Main"), ev(8, 1e6, 170, "Main"),
    ];
    const tgt: UpcomingEvent = { ...TARGET, event_name: "Main" };
    const base = await build(repeated, tgt, { calendarFeatures: true });
    const renamed = clone(repeated);
    renamed[1].event_name = "Xyz"; // was "Main" — changes the Main edition counts
    expect((await build(renamed, tgt, { calendarFeatures: true })).input.canonicalInputHash).not.toBe(
      base.input.canonicalInputHash,
    );
  });
  it("a target feature change (buy-in) changes targetInputHash", async () => {
    const base = await build();
    const after = await build(EVENTS, { ...TARGET, buy_in: 9_000_000 });
    expect(after.input.targetInputHash).not.toBe(base.input.targetInputHash);
  });
});

describe("B2 provenance — timezone, determinism, purity", () => {
  it("timezone-equivalent timing hashes identically (P0-1 + normalization)", async () => {
    const a = await buildForecastProvenance(EVENTS, TARGET, {}, TIMING);
    const b = await buildForecastProvenance(EVENTS, TARGET, {}, {
      forecastIssuedAt: "2026-02-10T03:00:00Z", // == 10:00 +07:00
      asOfTs: "2026-02-10T03:00:00Z",
      targetEventTs: "2026-02-15T12:00:00Z", // == 19:00 +07:00
    });
    expect(a.input.canonicalInputHash).toBe(b.input.canonicalInputHash);
  });
  it("is deterministic (same inputs ⇒ identical provenance)", async () => {
    expect(JSON.stringify(await build())).toBe(JSON.stringify(await build()));
  });
  it("does not mutate its inputs", async () => {
    const copy = JSON.stringify(EVENTS);
    await build();
    expect(JSON.stringify(EVENTS)).toBe(copy);
  });
});
