// A4a — model capability gate. Locks the sample-size/data-capability ladder as ONE typed evaluator and proves
// the refactor is behaviour-preserving: turnoutForecast + overlay decisions flip at exactly the old thresholds.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  evaluateModelCapability,
  FULL_FEATURE_THRESHOLD,
  HIGH_N_THRESHOLD,
  MIN_TRAIN_LENGTH,
  type CapabilityLevel,
  type CapabilityReason,
} from "./modelCapability";
import { forecastTurnout, type UpcomingEvent } from "./turnoutForecast";
import { simulateOverlayRisk, simulateOverlayFromForecast } from "./overlayRiskEngine";
import type { SeriesEvent } from "./nativeData";

describe("A4a modelCapability — canonical thresholds", () => {
  it("exposes the exact current constants (MIN_FULL=8, HIGH_N=12, CV_MIN_TRAIN=4)", () => {
    expect(FULL_FEATURE_THRESHOLD).toBe(8);
    expect(HIGH_N_THRESHOLD).toBe(12);
    expect(MIN_TRAIN_LENGTH).toBe(4);
  });
});

describe("A4a evaluateModelCapability — sample-size ladder at every boundary", () => {
  type Row = {
    n: number;
    level: CapabilityLevel;
    supportsForecast: boolean;
    supportsFullFeatures: boolean;
    reasons: CapabilityReason[];
  };
  // n=0,1,2,7,8,11,12,13 — the boundaries around n<=1, n<MIN_FULL, n>=MIN_FULL, n>=HIGH_N.
  const TABLE: Row[] = [
    { n: 0, level: "no_data", supportsForecast: false, supportsFullFeatures: false, reasons: ["NO_HISTORY"] },
    { n: 1, level: "no_data", supportsForecast: false, supportsFullFeatures: false, reasons: ["NO_HISTORY"] },
    { n: 2, level: "minimal", supportsForecast: true, supportsFullFeatures: false, reasons: ["INSUFFICIENT_TRAINING_ROWS"] },
    { n: 7, level: "reduced", supportsForecast: true, supportsFullFeatures: false, reasons: ["FULL_FEATURE_THRESHOLD_NOT_MET"] },
    { n: 8, level: "full", supportsForecast: true, supportsFullFeatures: true, reasons: [] },
    { n: 11, level: "full", supportsForecast: true, supportsFullFeatures: true, reasons: [] },
    { n: 12, level: "full", supportsForecast: true, supportsFullFeatures: true, reasons: [] },
    { n: 13, level: "full", supportsForecast: true, supportsFullFeatures: true, reasons: [] },
  ];

  for (const row of TABLE) {
    it(`n=${row.n} ⇒ ${row.level}`, () => {
      const cap = evaluateModelCapability({ kind: "sample_size", sampleSize: row.n });
      expect(cap.level).toBe(row.level);
      expect(cap.supportsForecast).toBe(row.supportsForecast);
      expect(cap.supportsFullFeatures).toBe(row.supportsFullFeatures);
      expect([...cap.reasons]).toEqual(row.reasons);
      expect(cap.sampleSize).toBe(row.n);
      expect(cap.minTrainLength).toBe(MIN_TRAIN_LENGTH);
      expect(cap.highNThreshold).toBe(HIGH_N_THRESHOLD);
      // the high-tier boundary tierFor() relies on: sampleSize >= highNThreshold ⟺ n >= 12
      expect(cap.sampleSize >= cap.highNThreshold).toBe(row.n >= 12);
    });
  }
});

describe("A4a evaluateModelCapability — overlay input completeness", () => {
  it("complete ⇒ usable, no reasons", () => {
    const cap = evaluateModelCapability({ kind: "overlay_inputs", inputsComplete: true });
    expect(cap.supportsForecast).toBe(true);
    expect(cap.level).toBe("full");
    expect([...cap.reasons]).toEqual([]);
  });
  it("incomplete ⇒ not usable, OVERLAY_INPUT_INCOMPLETE", () => {
    const cap = evaluateModelCapability({ kind: "overlay_inputs", inputsComplete: false });
    expect(cap.supportsForecast).toBe(false);
    expect(cap.level).toBe("no_data");
    expect([...cap.reasons]).toEqual(["OVERLAY_INPUT_INCOMPLETE"]);
  });
});

describe("A4a evaluateModelCapability — purity", () => {
  it("is deterministic (same input ⇒ identical output)", () => {
    const a = evaluateModelCapability({ kind: "sample_size", sampleSize: 5 });
    const b = evaluateModelCapability({ kind: "sample_size", sampleSize: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("does not mutate its input", () => {
    const input = { kind: "sample_size", sampleSize: 5 } as const;
    const copy = JSON.stringify(input);
    evaluateModelCapability(input);
    expect(JSON.stringify(input)).toBe(copy);
  });
  it("returns a frozen reasons array", () => {
    const cap = evaluateModelCapability({ kind: "sample_size", sampleSize: 0 });
    expect(Object.isFrozen(cap.reasons)).toBe(true);
  });
});

// --- behaviour-preserving parity: the gate drives the SAME turnoutForecast/overlay decisions as before ---
const pad = (x: number) => String(x).padStart(2, "0");
function ev(day: number, buy_in: number, entries: number | null): SeriesEvent {
  return {
    event_id: `evt-${day}`, event_name: "Event", event_date: `2026-02-${pad(day)}T19:00:00+07:00`,
    buy_in, fee: 100_000, serviceFeeAmount: null, gtd: null, prize_pool_actual: null,
    total_entries: entries, unique_entries: entries, reentries: 0, source: "csv", clubId: "c1", missingFields: [],
  };
}
const bys = [1_000_000, 2_000_000, 5_000_000];
const eventsN = (count: number): SeriesEvent[] =>
  Array.from({ length: count }, (_, i) => ev(i + 1, bys[i % 3], Math.round(2e8 / bys[i % 3]) + i));
const target: UpcomingEvent = { event_date: "2026-03-01T19:00:00+07:00", buy_in: 2_000_000, gtd: null };

describe("A4a parity — capability boundaries flip forecastTurnout exactly as before", () => {
  it("n=1 ⇒ unavailable (NO_HISTORY gate)", () => {
    const fc = forecastTurnout(eventsN(1), target);
    expect(fc.available).toBe(false);
    expect(fc.sampleSize).toBe(1);
  });
  it("n=2 ⇒ available, degraded, low", () => {
    const fc = forecastTurnout(eventsN(2), target);
    expect(fc.available).toBe(true);
    expect(fc.degraded).toBe(true);
    expect(fc.confidence).toBe("low");
  });
  it("n=8 ⇒ available, full features (not degraded), medium", () => {
    const fc = forecastTurnout(eventsN(8), target);
    expect(fc.available).toBe(true);
    expect(fc.degraded).toBe(false);
    expect(fc.confidence).toBe("medium");
  });
  it("n=12 ⇒ high tier (no ≥HIGH_N note)", () => {
    const fc = forecastTurnout(eventsN(12), target);
    expect(fc.confidence).toBe("high");
    expect(fc.missingDataNotes.some((s) => s.includes("độ tin cậy cao"))).toBe(false);
  });
  it("n=11 ⇒ medium tier, still shows the ≥HIGH_N note", () => {
    const fc = forecastTurnout(eventsN(11), target);
    expect(fc.confidence).toBe("medium");
    expect(fc.missingDataNotes.some((s) => s.includes("Cần ≥12 giải"))).toBe(true);
  });
});

describe("A4a parity — overlay usability gate unchanged", () => {
  it("simulateOverlayRisk: no observations ⇒ usable:false; with observations ⇒ usable:true", () => {
    const base = { buyinPrize: 1_000_000, fee: 100_000, gtd: 300_000_000, n: 5, seed: 1 };
    expect(simulateOverlayRisk({ ...base, observedEntries: [] }).usable).toBe(false);
    expect(simulateOverlayRisk({ ...base, observedEntries: [280, 310, 300] }).usable).toBe(true);
  });
  it("simulateOverlayFromForecast: sd<=0 ⇒ usable:false; valid ⇒ usable:true", () => {
    const base = { baseEntries: 300, buyinPrize: 1_000_000, fee: 100_000, gtd: 300_000_000, seed: 1 };
    expect(simulateOverlayFromForecast({ ...base, logSd: 0 }).usable).toBe(false);
    expect(simulateOverlayFromForecast({ ...base, logSd: 0.3 }).usable).toBe(true);
  });
});

// req-7 structural guard: the sample-size thresholds live ONLY in modelCapability. No brittle number-hunting —
// assert the OLD local constants are no longer DECLARED in the callers and that both engines import the gate.
describe("A4a — no caller re-declares the centralized thresholds", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const turnoutSrc = read("./turnoutForecast.ts");
  const overlaySrc = read("./overlayRiskEngine.ts");

  it("turnoutForecast no longer declares MIN_FULL / HIGH_N / CV_MIN_TRAIN and imports the gate", () => {
    expect(/const\s+MIN_FULL\s*=/.test(turnoutSrc)).toBe(false);
    expect(/const\s+HIGH_N\s*=/.test(turnoutSrc)).toBe(false);
    expect(/const\s+CV_MIN_TRAIN\s*=/.test(turnoutSrc)).toBe(false);
    expect(turnoutSrc.includes('from "./modelCapability"')).toBe(true);
    expect(turnoutSrc.includes("evaluateModelCapability")).toBe(true);
  });
  it("overlayRiskEngine routes its usability guard through the gate", () => {
    expect(overlaySrc.includes('from "./modelCapability"')).toBe(true);
    expect(overlaySrc.includes("evaluateModelCapability")).toBe(true);
  });
});
