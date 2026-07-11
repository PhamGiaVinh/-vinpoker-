// B2 - structured forecast provenance. Locks the layered identity contract + the owner-review hardening:
// manual has NO engine/training identity; asOfTs + target-time truthfulness; forecast-identity eligibility (not
// full B1 calibration eligibility); calibrationPoolId; inputContentHash/forecastInstanceId split; fail-closed.
import { describe, it, expect } from "vitest";
import {
  buildForecastProvenance,
  isForecastIdentityEligible,
  isEngineProvenance,
  SELECTION_PROTOCOL_DIRECT,
  type ForecastTiming,
  type ForecastProvenance,
  type EngineForecastProvenance,
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
  targetEventTs: "2026-02-15T19:00:00+07:00", // matches TARGET.event_date
};
const clone = (e: SeriesEvent[]) => e.map((x) => ({ ...x }));
const build = (events = EVENTS, target = TARGET, opts: ForecastOptions = {}, meta = {}, timing = TIMING) =>
  buildForecastProvenance(events, target, opts, timing, meta);
// Narrow to an engine provenance (fails the test if manual).
const eng = (p: ForecastProvenance): EngineForecastProvenance => {
  if (!isEngineProvenance(p)) throw new Error("expected engine provenance");
  return p;
};
// Return the ProvenanceError.code of a rejected build (or a sentinel), for fail-closed assertions.
const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try { await p; return "NO_THROW"; } catch (e) { return (e as { code?: string }).code; }
};

describe("B2 provenance — shape, completeness, eligibility", () => {
  it("stamps engine/feature-schema identity + the full layered hash set", async () => {
    const p = eng(await build());
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
    expect(p.timing.asOfTs.endsWith("Z")).toBe(true);
  });
  it("forecastIdentityEligible: engine+complete ⇒ true; unknown sha / manual / manual_override ⇒ false", async () => {
    expect((await build()).forecastIdentityEligible).toBe(false); // default sha unknown ⇒ missing_code_sha
    const complete = await build(EVENTS, TARGET, {}, { codeSha: "abc1234" });
    expect(complete.completeness).toBe("complete");
    expect(complete.forecastIdentityEligible).toBe(true);
    expect(isForecastIdentityEligible(complete)).toBe(true);
    const override = await build(EVENTS, TARGET, {}, { kind: "manual_override", codeSha: "abc1234", derivedFromInputHash: "a".repeat(64) });
    expect(override.forecastIdentityEligible).toBe(false); // manual_override never eligible
  });
});

describe("B2 manual has NO engine/training identity (fix 1)", () => {
  it("manual carries no predictor/input, is ineligible, fabricates no engine fields", async () => {
    const m = await build(EVENTS, TARGET, {}, { kind: "manual" });
    expect(m.kind).toBe("manual");
    expect(m.predictor).toBeNull();
    expect(m.input).toBeNull();
    expect(m.forecastIdentityEligible).toBe(false);
    expect(m.completeness).toBe("manual");
    expect(m.derivedFromInputHash).toBeNull();
    expect(isEngineProvenance(m)).toBe(false);
  });
  it("manual does NOT run the engine path — a training input later than asOfTs is fine (engine would reject)", async () => {
    const feb12: SeriesEvent = { ...ev(12, 1_000_000, 300), event_id: "feb12", event_date: "2026-02-12T19:00:00+07:00" };
    expect(await codeOf(build([...EVENTS, feb12]))).toBe("AS_OF_INPUT_MISMATCH"); // engine rejects
    const m = await build([...EVENTS, feb12], TARGET, {}, { kind: "manual" }); // manual does not
    expect(m.kind).toBe("manual");
    expect(m.input).toBeNull();
  });
  it("manual_override retains engine lineage + hashes but is ineligible", async () => {
    const o = eng(await build(EVENTS, TARGET, {}, { kind: "manual_override", codeSha: "abc1234", derivedFromInputHash: "b".repeat(64) }));
    expect(o.input.predictorId).toMatch(/^[0-9a-f]{64}$/); // engine hashes present
    expect(o.derivedFromInputHash).toBe("b".repeat(64)); // lineage kept
    expect(o.forecastIdentityEligible).toBe(false);
  });
});

describe("B2 pool identity — B1 pools by calibrationPoolId (rule 3)", () => {
  it("predictorId is STABLE across different targets; inputContentHash differs", async () => {
    const a = eng(await build(EVENTS, TARGET));
    const t2: ForecastTiming = { ...TIMING, targetEventTs: "2026-03-20T12:00:00+07:00" }; // matches the 2nd target
    const b = eng(await build(EVENTS, { event_date: "2026-03-20T12:00:00+07:00", buy_in: 5_000_000, gtd: 200_000_000 }, {}, {}, t2));
    expect(a.input.predictorId).toBe(b.input.predictorId);
    expect(a.input.inputContentHash).not.toBe(b.input.inputContentHash);
  });
  it("calibrationPoolId folds in trialCount + selectionProtocolId (predictorId stays the same)", async () => {
    const base = eng(await build(EVENTS, TARGET, {}, { codeSha: "abc1234", trialCount: 1 }));
    const moreTrials = eng(await build(EVENTS, TARGET, {}, { codeSha: "abc1234", trialCount: 5 }));
    const otherProtocol = eng(await build(EVENTS, TARGET, {}, { codeSha: "abc1234", selectionProtocolId: "tuned-1" }));
    expect(moreTrials.input.predictorId).toBe(base.input.predictorId);
    expect(moreTrials.input.calibrationPoolId).not.toBe(base.input.calibrationPoolId);
    expect(otherProtocol.input.calibrationPoolId).not.toBe(base.input.calibrationPoolId);
  });
});

describe("B2 inputContentHash vs forecastInstanceId (rule 4)", () => {
  it("same input issued twice ⇒ same inputContentHash, different forecastInstanceId", async () => {
    const t1: ForecastTiming = { ...TIMING, forecastIssuedAt: "2026-02-10T10:00:00+07:00" };
    const t2: ForecastTiming = { ...TIMING, forecastIssuedAt: "2026-02-10T18:00:00+07:00" }; // later issuance, same asOf
    const a = eng(await build(EVENTS, TARGET, {}, {}, t1));
    const b = eng(await build(EVENTS, TARGET, {}, {}, t2));
    expect(a.input.inputContentHash).toBe(b.input.inputContentHash);
    expect(a.input.forecastInstanceId).not.toBe(b.input.forecastInstanceId);
  });
});

describe("B2 input identity — what changes the hash (P0-3, P0-4)", () => {
  it("a HISTORICAL training row's entries changes trainingDataHash, NOT predictorId", async () => {
    const base = eng(await build());
    const mut = clone(EVENTS);
    mut[2].total_entries = (mut[2].total_entries ?? 0) + 999;
    const after = eng(await build(mut));
    expect(after.input.trainingDataHash).not.toBe(base.input.trainingDataHash);
    expect(after.input.inputContentHash).not.toBe(base.input.inputContentHash);
    expect(after.input.predictorId).toBe(base.input.predictorId);
  });
  it("a FUTURE event (after the target) does NOT change identity — it is not a training row", async () => {
    const base = eng(await build());
    const future: SeriesEvent = { ...ev(9, 3_000_000, 400, "Future"), event_id: "future", event_date: "2026-03-01T19:00:00+07:00" };
    expect(eng(await build([...EVENTS, future])).input.inputContentHash).toBe(base.input.inputContentHash);
  });
  it("renaming a display-only event_name (same resolved type) is inert (P0-4)", async () => {
    const base = eng(await build(EVENTS, TARGET, {}));
    const renamed = clone(EVENTS);
    renamed[0].event_name = "Totally Different Display Name";
    expect(eng(await build(renamed, TARGET, {})).input.inputContentHash).toBe(base.input.inputContentHash);
  });
  it("a target feature change (buy-in) changes targetInputHash", async () => {
    const base = eng(await build());
    const after = eng(await build(EVENTS, { ...TARGET, buy_in: 9_000_000 }));
    expect(after.input.targetInputHash).not.toBe(base.input.targetInputHash);
  });
});

describe("B2 asOfTs truthfulness (rule 1)", () => {
  it("rejects when a training input is later than asOfTs (never silently filtered)", async () => {
    const feb12: SeriesEvent = { ...ev(12, 1_000_000, 300), event_id: "feb12", event_date: "2026-02-12T19:00:00+07:00" };
    expect(await codeOf(build([...EVENTS, feb12]))).toBe("AS_OF_INPUT_MISMATCH");
  });
  it("rejects when the target's edition feature used a later (post-asOfTs) edition (calendar ON)", async () => {
    const mains = Array.from({ length: 6 }, (_, i) => ev(i + 1, 1_000_000, 100 + i, "Main"));
    const tgt: UpcomingEvent = { ...TARGET, event_name: "Main" };
    const ghost: SeriesEvent = { ...ev(20, 1_000_000, null, "Main"), event_id: "ghost", event_date: "2026-02-12T19:00:00+07:00" };
    expect(await codeOf(build(mains, tgt, { calendarFeatures: true }))).toBe("NO_THROW"); // control
    expect(await codeOf(build([...mains, ghost], tgt, { calendarFeatures: true }))).toBe("AS_OF_INPUT_MISMATCH");
  });
});

describe("B2 target-time consistency (fix 2)", () => {
  it("rejects when timing.targetEventTs is a different instant than target.event_date", async () => {
    const mismatch: ForecastTiming = { ...TIMING, targetEventTs: "2026-02-16T19:00:00+07:00" }; // != Feb 15
    expect(await codeOf(build(EVENTS, TARGET, {}, {}, mismatch))).toBe("TARGET_TIME_MISMATCH");
  });
  it("accepts a timezone-equivalent target instant", async () => {
    const tzEq: ForecastTiming = { ...TIMING, targetEventTs: "2026-02-15T12:00:00Z" }; // == Feb 15 19:00 +07:00
    expect(await codeOf(build(EVENTS, TARGET, {}, {}, tzEq))).toBe("NO_THROW");
  });
});

describe("B2 fail-closed validations (rule 5 + fix 4)", () => {
  it("trialCount must be a positive integer", async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(await codeOf(build(EVENTS, TARGET, {}, { trialCount: bad }))).toBe("INVALID_TRIAL_COUNT");
    }
  });
  it("asOfTs must be <= forecastIssuedAt", async () => {
    const bad: ForecastTiming = { ...TIMING, asOfTs: "2026-02-12T10:00:00+07:00", forecastIssuedAt: "2026-02-10T10:00:00+07:00" };
    expect(await codeOf(build(EVENTS, TARGET, {}, {}, bad))).toBe("AS_OF_AFTER_ISSUED");
  });
  it("manual_override requires a valid 64-hex derivedFromInputHash; engine/manual forbid it", async () => {
    expect(await codeOf(build(EVENTS, TARGET, {}, { kind: "manual_override" }))).toBe("INVALID_DERIVED_FROM");
    expect(await codeOf(build(EVENTS, TARGET, {}, { kind: "manual_override", derivedFromInputHash: "xyz" }))).toBe("INVALID_DERIVED_FROM");
    expect(await codeOf(build(EVENTS, TARGET, {}, { derivedFromInputHash: "a".repeat(64) }))).toBe("UNEXPECTED_DERIVED_FROM");
    expect(await codeOf(build(EVENTS, TARGET, {}, { kind: "manual", derivedFromInputHash: "a".repeat(64) }))).toBe("UNEXPECTED_DERIVED_FROM");
  });
  it("codeSha is normalized (lowercased) and validated", async () => {
    const p = eng(await build(EVENTS, TARGET, {}, { codeSha: "  ABC1234DEF  " }));
    expect(p.predictor.codeSha).toBe("abc1234def");
    expect(p.completeness).toBe("complete");
    expect(await codeOf(build(EVENTS, TARGET, {}, { codeSha: "not-a-sha!" }))).toBe("INVALID_CODE_SHA");
  });
  it("selectionProtocolId is validated as a stable machine identifier (fix 4)", async () => {
    for (const bad of ["", "   ", "has space", "1bad", "bad!id"]) {
      expect(await codeOf(build(EVENTS, TARGET, {}, { codeSha: "abc1234", selectionProtocolId: bad }))).toBe("INVALID_SELECTION_PROTOCOL");
    }
    const ok = eng(await build(EVENTS, TARGET, {}, { codeSha: "abc1234", selectionProtocolId: "  tuned_v2-1  " }));
    expect(ok.predictor.selectionProtocolId).toBe("tuned_v2-1"); // trimmed + lowercased
  });
  it("selectionProtocolId casing cannot accidentally mint a second calibration pool (fix 3)", async () => {
    const lower = eng(await build(EVENTS, TARGET, {}, { codeSha: "abc1234", selectionProtocolId: "tuned-1" }));
    const upper = eng(await build(EVENTS, TARGET, {}, { codeSha: "abc1234", selectionProtocolId: "  TUNED-1  " }));
    expect(upper.predictor.selectionProtocolId).toBe("tuned-1"); // trimmed + lowercased to the same id
    expect(upper.input.calibrationPoolId).toBe(lower.input.calibrationPoolId); // ⇒ same pool
  });
});

describe("B2 target capacity — censoring caps the band, so it enters identity (fix 1)", () => {
  const cap = (c: number | null | undefined): UpcomingEvent => ({ ...TARGET, capacity: c });
  it("censoring ON: changing target.capacity changes targetInputHash AND inputContentHash", async () => {
    const a = eng(await build(EVENTS, cap(500), { censoring: true }));
    const b = eng(await build(EVENTS, cap(600), { censoring: true }));
    expect(a.input.targetInputHash).not.toBe(b.input.targetInputHash);
    expect(a.input.inputContentHash).not.toBe(b.input.inputContentHash);
  });
  it("censoring OFF: changing target.capacity leaves the hashes unchanged (capacity cannot move the output)", async () => {
    const a = eng(await build(EVENTS, cap(500), {}));
    const b = eng(await build(EVENTS, cap(600), {}));
    expect(a.input.targetInputHash).toBe(b.input.targetInputHash);
    expect(a.input.inputContentHash).toBe(b.input.inputContentHash);
  });
  it("null / absent capacity is deterministic (both hash as the no-cap identity)", async () => {
    const noCap = eng(await build(EVENTS, TARGET, { censoring: true }));
    const nullCap1 = eng(await build(EVENTS, cap(null), { censoring: true }));
    const nullCap2 = eng(await build(EVENTS, cap(null), { censoring: true }));
    expect(nullCap1.input.targetInputHash).toBe(noCap.input.targetInputHash);
    expect(nullCap1.input.targetInputHash).toBe(nullCap2.input.targetInputHash);
  });
  it("invalid capacity: non-positive follows the engine contract (no cap); non-finite fails closed", async () => {
    const noCap = eng(await build(EVENTS, TARGET, { censoring: true })); // undefined ⇒ null ⇒ no cap
    for (const z of [0, -50]) {
      // engine ignores capacity <= 0 ⇒ identity MUST equal the no-cap hash (no false identity change)
      expect(eng(await build(EVENTS, cap(z), { censoring: true })).input.targetInputHash).toBe(noCap.input.targetInputHash);
    }
    // NaN / Infinity can never be a seat count ⇒ fail closed explicitly
    expect(await codeOf(build(EVENTS, cap(Number.NaN), { censoring: true }))).toBe("INVALID_CAPACITY");
    expect(await codeOf(build(EVENTS, cap(Number.POSITIVE_INFINITY), { censoring: true }))).toBe("INVALID_CAPACITY");
  });
});

describe("B2 provenance — timezone, determinism, purity", () => {
  it("timezone-equivalent timing hashes identically", async () => {
    const a = eng(await build());
    const b = eng(await build(EVENTS, TARGET, {}, {}, {
      forecastIssuedAt: "2026-02-10T03:00:00Z", asOfTs: "2026-02-10T03:00:00Z", targetEventTs: "2026-02-15T12:00:00Z",
    }));
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
