// B2 — structured forecast provenance. Locks the layered identity contract + the owner-review hardening:
// asOfTs truthfulness, calibration eligibility, calibrationPoolId, inputContentHash/forecastInstanceId split,
// and the fail-closed validations. The target's own outcome is never hashed; a historical training outcome is.
import { describe, it, expect } from "vitest";
import {
  buildForecastProvenance,
  isCalibrationEligible,
  SELECTION_PROTOCOL_DIRECT,
  type ForecastTiming,
} from "./forecastProvenance";
import { ENGINE_VERSION, type UpcomingEvent, type ForecastOptions } from "./turnoutForecast";
import { FEATURE_SCHEMA_VERSION } from "./featureBoundary";
import type { SeriesEvent } from "./nativeData";

const pad = (n: number) => String(n).padStart(2, "0");
function ev(day: number, buy_in: number, entries: number | null, name = "Event"): SeriesEvent {
  return {
    event_id: `e-${day}`, event_name: name, event_date: `2026-01-${pad(day)}T19:00:00+07:00`,
    buy_in, fee: 100_000, serviceFeeAmount: null, gtd: null, prize_pool_actual: null,
    total_entries: entries, unique_entries: entries, reentries: 0, source: "csv", clubId: "c1", missingFields: [],
  };
}
const bys = [1_000_000, 2_000_000, 5_000_000];
const EVENTS = Array.from({ length: 8 }, (_, i) => ev(i + 1, bys[i % 3], 100 + i * 7));
const TARGET: UpcomingEvent = { event_date: "2026-02-15T19:00:00+07:00", buy_in: 2_000_000, gtd: null };
const TIMING: ForecastTiming = {
  forecastIssuedAt: "2026-02-10T10:00:00+07:00", // all EVENTS (Jan) are observable by this asOf
  asOfTs: "2026-02-10T10:00:00+07:00",
  targetEventTs: "2026-02-15T19:00:00+07:00",
};
const clone = (e: SeriesEvent[]) => e.map((x) => ({ ...x }));
const build = (events = EVENTS, target = TARGET, opts: ForecastOptions = {}, meta = {}, timing = TIMING) =>
  buildForecastProvenance(events, target, opts, timing, meta);
// Return the ProvenanceError.code of a rejected build (or a sentinel), for fail-closed assertions.
const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try { await p; return "NO_THROW"; } catch (e) { return (e as { code?: string }).code; }
};

describe("B2 provenance — shape, completeness, eligibility", () => {
  it("stamps engine/feature-schema identity + the full layered hash set", async () => {
    const p = await build();
    expect(p.predictor.engineVersion).toBe(ENGINE_VERSION);
    expect(p.predictor.featureSchemaVersion).toBe(FEATURE_SCHEMA_VERSION);
    expect(p.predictor.trialCount).toBe(1);
    expect(p.predictor.selectionProtocolId).toBe(SELECTION_PROTOCOL_DIRECT);
    for (const h of [
      p.input.predictorId, p.input.calibrationPoolId, p.input.targetInputHash,
      p.input.trainingDataHash, p.input.inputContentHash, p.input.forecastInstanceId,
    ]) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(p.timing.asOfTs.endsWith("Z")).toBe(true); // normalized to UTC
  });
  it("completeness + calibrationEligible: engine+complete ⇒ eligible; unknown sha / manual ⇒ not", async () => {
    expect((await build()).completeness).toBe("missing_code_sha"); // default sha unknown
    expect((await build()).calibrationEligible).toBe(false);
    const complete = await build(EVENTS, TARGET, {}, { codeSha: "abc1234" });
    expect(complete.completeness).toBe("complete");
    expect(complete.calibrationEligible).toBe(true);
    expect(isCalibrationEligible(complete)).toBe(true);
    const manual = await build(EVENTS, TARGET, {}, { kind: "manual" });
    expect(manual.completeness).toBe("manual");
    expect(manual.calibrationEligible).toBe(false);
    const override = await build(EVENTS, TARGET, {}, { kind: "manual_override", codeSha: "abc1234", derivedFromInputHash: "a".repeat(64) });
    expect(override.calibrationEligible).toBe(false); // manual_override never poolable
  });
});

describe("B2 pool identity — B1 pools by calibrationPoolId, not predictorId (rule 3)", () => {
  it("predictorId is STABLE across different targets; inputContentHash differs", async () => {
    const a = await build(EVENTS, TARGET);
    const b = await build(EVENTS, { event_date: "2026-03-20T12:00:00+07:00", buy_in: 5_000_000, gtd: 200_000_000 });
    expect(a.input.predictorId).toBe(b.input.predictorId);
    expect(a.input.inputContentHash).not.toBe(b.input.inputContentHash);
  });
  it("calibrationPoolId folds in trialCount + selectionProtocolId (predictorId stays the same)", async () => {
    const base = await build(EVENTS, TARGET, {}, { codeSha: "abc1234", trialCount: 1 });
    const moreTrials = await build(EVENTS, TARGET, {}, { codeSha: "abc1234", trialCount: 5 });
    const otherProtocol = await build(EVENTS, TARGET, {}, { codeSha: "abc1234", selectionProtocolId: "tuned-1" });
    expect(moreTrials.input.predictorId).toBe(base.input.predictorId);
    expect(moreTrials.input.calibrationPoolId).not.toBe(base.input.calibrationPoolId);
    expect(otherProtocol.input.calibrationPoolId).not.toBe(base.input.calibrationPoolId);
  });
});

describe("B2 inputContentHash vs forecastInstanceId (rule 4)", () => {
  it("same input issued twice ⇒ same inputContentHash, different forecastInstanceId", async () => {
    const t1: ForecastTiming = { ...TIMING, forecastIssuedAt: "2026-02-10T10:00:00+07:00" };
    const t2: ForecastTiming = { ...TIMING, forecastIssuedAt: "2026-02-10T18:00:00+07:00" }; // later issuance, same asOf
    const a = await build(EVENTS, TARGET, {}, {}, t1);
    const b = await build(EVENTS, TARGET, {}, {}, t2);
    expect(a.input.inputContentHash).toBe(b.input.inputContentHash); // content identical
    expect(a.input.forecastInstanceId).not.toBe(b.input.forecastInstanceId); // instance differs
  });
});

describe("B2 input identity — what changes the hash (P0-3, P0-4)", () => {
  it("a HISTORICAL training row's entries changes trainingDataHash, NOT predictorId", async () => {
    const base = await build();
    const mut = clone(EVENTS);
    mut[2].total_entries = (mut[2].total_entries ?? 0) + 999;
    const after = await build(mut);
    expect(after.input.trainingDataHash).not.toBe(base.input.trainingDataHash);
    expect(after.input.inputContentHash).not.toBe(base.input.inputContentHash);
    expect(after.input.predictorId).toBe(base.input.predictorId);
  });
  it("a FUTURE event (after the target) does NOT change identity — it is not a training row", async () => {
    const base = await build();
    const future: SeriesEvent = { ...ev(9, 3_000_000, 400, "Future"), event_id: "future", event_date: "2026-03-01T19:00:00+07:00" };
    expect((await build([...EVENTS, future])).input.inputContentHash).toBe(base.input.inputContentHash);
  });
  it("renaming a display-only event_name (same resolved type) is inert (P0-4)", async () => {
    const base = await build(EVENTS, TARGET, {});
    const renamed = clone(EVENTS);
    renamed[0].event_name = "Totally Different Display Name";
    expect((await build(renamed, TARGET, {})).input.inputContentHash).toBe(base.input.inputContentHash);
  });
  it("a target feature change (buy-in) changes targetInputHash", async () => {
    const base = await build();
    const after = await build(EVENTS, { ...TARGET, buy_in: 9_000_000 });
    expect(after.input.targetInputHash).not.toBe(base.input.targetInputHash);
  });
});

describe("B2 asOfTs truthfulness (rule 1)", () => {
  it("rejects when a training input is later than asOfTs (never silently filtered)", async () => {
    const feb12: SeriesEvent = { ...ev(12, 1_000_000, 300), event_id: "feb12", event_date: "2026-02-12T19:00:00+07:00" };
    expect(await codeOf(build([...EVENTS, feb12]))).toBe("AS_OF_INPUT_MISMATCH"); // Feb 12 > asOf Feb 10, < target
  });
  it("rejects when the target's edition feature used a later (post-asOfTs) edition (calendar ON)", async () => {
    const mains = Array.from({ length: 6 }, (_, i) => ev(i + 1, 1_000_000, 100 + i, "Main"));
    const tgt: UpcomingEvent = { ...TARGET, event_name: "Main" };
    // a ghost edition (no entries → not a training row) after asOfTs shifts editionTrend for the target
    const ghost: SeriesEvent = { ...ev(20, 1_000_000, null, "Main"), event_id: "ghost", event_date: "2026-02-12T19:00:00+07:00" };
    expect(await codeOf(build(mains, tgt, { calendarFeatures: true }))).toBe("NO_THROW"); // control: no leak
    expect(await codeOf(build([...mains, ghost], tgt, { calendarFeatures: true }))).toBe("AS_OF_INPUT_MISMATCH");
  });
});

describe("B2 fail-closed validations (rule 5)", () => {
  it("trialCount must be a positive integer", async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(await codeOf(build(EVENTS, TARGET, {}, { trialCount: bad }))).toBe("INVALID_TRIAL_COUNT");
    }
  });
  it("asOfTs must be <= forecastIssuedAt", async () => {
    const bad: ForecastTiming = { ...TIMING, asOfTs: "2026-02-12T10:00:00+07:00", forecastIssuedAt: "2026-02-10T10:00:00+07:00" };
    expect(await codeOf(build(EVENTS, TARGET, {}, {}, bad))).toBe("AS_OF_AFTER_ISSUED");
  });
  it("manual_override requires a valid 64-hex derivedFromInputHash", async () => {
    expect(await codeOf(build(EVENTS, TARGET, {}, { kind: "manual_override" }))).toBe("INVALID_DERIVED_FROM");
    expect(await codeOf(build(EVENTS, TARGET, {}, { kind: "manual_override", derivedFromInputHash: "xyz" }))).toBe("INVALID_DERIVED_FROM");
    expect(await codeOf(build(EVENTS, TARGET, {}, { kind: "manual_override", codeSha: "abc1234", derivedFromInputHash: "b".repeat(64) }))).toBe("NO_THROW");
  });
  it("engine and manual must NOT carry derivedFromInputHash", async () => {
    expect(await codeOf(build(EVENTS, TARGET, {}, { derivedFromInputHash: "a".repeat(64) }))).toBe("UNEXPECTED_DERIVED_FROM");
    expect(await codeOf(build(EVENTS, TARGET, {}, { kind: "manual", derivedFromInputHash: "a".repeat(64) }))).toBe("UNEXPECTED_DERIVED_FROM");
  });
  it("codeSha is normalized (lowercased) and validated", async () => {
    const p = await build(EVENTS, TARGET, {}, { codeSha: "  ABC1234DEF  " });
    expect(p.predictor.codeSha).toBe("abc1234def");
    expect(p.completeness).toBe("complete");
    expect(await codeOf(build(EVENTS, TARGET, {}, { codeSha: "not-a-sha!" }))).toBe("INVALID_CODE_SHA");
  });
});

describe("B2 provenance — timezone, determinism, purity", () => {
  it("timezone-equivalent timing hashes identically", async () => {
    const a = await build();
    const b = await build(EVENTS, TARGET, {}, {}, {
      forecastIssuedAt: "2026-02-10T03:00:00Z", asOfTs: "2026-02-10T03:00:00Z", targetEventTs: "2026-02-15T12:00:00Z",
    });
    expect(a.input.inputContentHash).toBe(b.input.inputContentHash);
    expect(a.input.forecastInstanceId).toBe(b.input.forecastInstanceId);
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
