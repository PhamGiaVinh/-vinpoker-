// Series Intelligence — Scenario Outlook Lite (Phase 4, read-only, PURE).
//
// Rules-based PLANNING scenarios for the owner: Conservative / Base / Upside.
// This is NOT machine learning and NOT a prediction.
//
// SCOPE (important): each scenario is a range for ONE comparable event
// (per-event), derived from quantiles of the club's OWN observed event entry
// counts. It is NOT a full-series forecast and never implies "the series will
// reach X". Volumes are PER-EVENT reference figures (buy-in / fee / prize), not
// revenue or profit.
//
// HONESTY CONTRACT (ties to the merged Club Intelligence safety contract):
//  - Labels are only Known Rule / Observed Pattern / Hypothesis. Never
//    `Model Estimate` / `Tested Finding`.
//  - No extrapolation beyond observed data: Upside is capped at the observed max.
//  - GTD has no native column yet → gtdRisk is always null (no overlay computed).
//  - Missing buy_in/fee/prize degrade gracefully to null ranges; every output
//    carries missing-data notes. Copy uses "có thể / khoảng", never "sẽ /
//    chắc chắn / đảm bảo".

import type { SeriesEvent } from "./nativeData";
import type {
  InsightLabel,
  OwnerAction,
  ReadinessResult,
  RiskFlag,
  SeriesEconomics,
} from "./commandCenter";

export type ScenarioKind = "conservative" | "base" | "upside";
export type ScenarioConfidence = "low" | "medium" | "high";

export interface Range {
  low: number;
  high: number;
}

export interface Scenario {
  kind: ScenarioKind;
  label: string;
  /** Entry range for ONE comparable event (not a series total). */
  entryRange: Range;
  /** Per-event reference volumes (NOT revenue/profit). null when not derivable. */
  buyInVolumeRange: Range | null;
  feeVolumeRange: Range | null;
  prizePoolRange: Range | null;
  /** Only set if GTD data exists; null today (no native GTD column) → no overlay. */
  gtdRisk: string | null;
  confidence: ScenarioConfidence;
  missingDataNotes: string[];
  insightLabel: InsightLabel;
  copy: string;
}

export interface ScenarioOutlookResult {
  available: boolean;
  scenarios: Scenario[];
  confidence: ScenarioConfidence;
  missingDataNotes: string[];
  /** Number of observed events that have an entry count (the scenario basis). */
  sampleSize: number;
  disclaimer: string;
}

const DISCLAIMER =
  "Đây là kịch bản tham khảo cho MỘT event tương tự, theo dữ liệu hiện có và quy tắc vận hành — không phải dự đoán chắc chắn. Volume tham khảo, không thay thế báo cáo kế toán.";

function sortedAsc(values: Array<number | null>): number[] {
  return values.filter((v): v is number => v !== null).sort((a, b) => a - b);
}

/** Caller guarantees a non-empty sorted-asc array. */
function percentile(asc: number[], p: number): number {
  const idx = Math.min(asc.length - 1, Math.floor(p * (asc.length - 1)));
  return asc[idx];
}

function median(values: Array<number | null>): number | null {
  const s = sortedAsc(values);
  if (s.length === 0) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function scaleRange(r: Range, perEntry: number | null): Range | null {
  if (perEntry === null) return null;
  return { low: r.low * perEntry, high: r.high * perEntry };
}

/** Confidence from sample size + readiness. Low sample (<4) or low readiness ⇒ low. */
export function computeScenarioConfidence(
  events: SeriesEvent[],
  readiness: ReadinessResult,
): ScenarioConfidence {
  const sampleSize = events.filter((e) => e.total_entries !== null).length;
  if (sampleSize < 4 || readiness.score < 40) return "low";
  if (sampleSize >= 8 && readiness.score >= 70) return "high";
  return "medium";
}

/** Plain-VN notes on what weakens the scenarios. GTD is always flagged (no column yet). */
export function computeScenarioMissingData(events: SeriesEvent[]): string[] {
  const notes: string[] = [];
  const n = events.length;
  const missing = (pred: (e: SeriesEvent) => boolean) => events.filter(pred).length;

  if (events.some((e) => e.gtd === null)) {
    notes.push("GTD chưa có dữ liệu — không tính được rủi ro overlay.");
  }
  const mEntries = missing((e) => e.total_entries === null);
  const mBuyIn = missing((e) => e.buy_in === null);
  const mFee = missing((e) => e.fee === null);
  const mPrize = missing((e) => e.prize_pool_actual === null);
  if (mEntries > 0) notes.push(`${mEntries}/${n} giải thiếu số entry — thu hẹp cơ sở kịch bản.`);
  if (mBuyIn > 0) notes.push(`${mBuyIn}/${n} giải thiếu buy-in — buy-in volume tham khảo có thể không đủ.`);
  if (mFee > 0) notes.push(`${mFee}/${n} giải thiếu fee — fee volume tham khảo có thể không đủ.`);
  if (mPrize > 0) notes.push(`${mPrize}/${n} giải thiếu prize pool.`);
  return notes;
}

/**
 * Build the three per-event scenarios from observed entry quantiles.
 * `economics` and `risks` are accepted for a stable signature / future use; the
 * ranges come from the events directly.
 */
export function computeScenarioOutlook(
  events: SeriesEvent[],
  _economics: SeriesEconomics,
  readiness: ReadinessResult,
  _risks: RiskFlag[],
): ScenarioOutlookResult {
  const entries = sortedAsc(events.map((e) => e.total_entries));
  const confidence = computeScenarioConfidence(events, readiness);
  const missingDataNotes = computeScenarioMissingData(events);
  const sampleSize = entries.length;

  if (sampleSize === 0) {
    return { available: false, scenarios: [], confidence, missingDataNotes, sampleSize: 0, disclaimer: DISCLAIMER };
  }

  const pMin = entries[0];
  const p25 = percentile(entries, 0.25);
  const p75 = percentile(entries, 0.75);
  const pMax = entries[entries.length - 1];

  const buyInPerEntry = median(events.map((e) => e.buy_in));
  const feePerEntry = median(events.map((e) => e.fee));
  const prizePerEntry = median(
    events.map((e) =>
      e.prize_pool_actual !== null && e.total_entries !== null && e.total_entries > 0
        ? e.prize_pool_actual / e.total_entries
        : null,
    ),
  );

  // GTD has no native column yet → no overlay risk computed for any scenario.
  const gtdHasData = events.some((e) => e.gtd !== null);
  const r0 = (x: number) => Math.round(x);

  const build = (
    kind: ScenarioKind,
    label: string,
    entryRange: Range,
    insightLabel: InsightLabel,
    copy: string,
  ): Scenario => ({
    kind,
    label,
    entryRange,
    buyInVolumeRange: scaleRange(entryRange, buyInPerEntry),
    feeVolumeRange: scaleRange(entryRange, feePerEntry),
    prizePoolRange: scaleRange(entryRange, prizePerEntry),
    gtdRisk: gtdHasData ? "GTD có dữ liệu — xem overlay trong bản đầy đủ." : null,
    confidence,
    missingDataNotes,
    insightLabel,
    copy,
  });

  const scenarios: Scenario[] = [
    build(
      "conservative",
      "Thận trọng",
      { low: pMin, high: p25 },
      "Observed Pattern",
      `Nếu field ở mức thấp như các event đã ghi nhận, mỗi event có thể quanh ${r0(pMin)}–${r0(p25)} lượt entry.`,
    ),
    build(
      "base",
      "Cơ sở",
      { low: p25, high: p75 },
      "Observed Pattern",
      `Theo vùng phổ biến của các event tương tự, mỗi event có thể quanh ${r0(p25)}–${r0(p75)} lượt entry.`,
    ),
    build(
      "upside",
      "Tích cực",
      { low: p75, high: pMax },
      "Hypothesis",
      `Giả thuyết tốt (chặn ở mức cao nhất đã ghi nhận): mỗi event có thể tới ${r0(p75)}–${r0(pMax)} lượt entry nếu field/marketing thuận lợi.`,
    ),
  ];

  return { available: true, scenarios, confidence, missingDataNotes, sampleSize, disclaimer: DISCLAIMER };
}

/** Planning actions derived from the scenarios + risks. Concrete, never a guarantee. */
export function computeScenarioActions(scenarios: Scenario[], risks: RiskFlag[]): OwnerAction[] {
  const actions: OwnerAction[] = [];
  if (scenarios.length === 0) return actions;

  actions.push({
    id: "scenario-upside-push",
    label: "Hypothesis",
    text: "Nếu hướng tới kịch bản Tích cực, chuẩn bị marketing / satellite sớm",
    rationale: "Kịch bản cao chỉ là giả thuyết — cần lực đẩy field, không tự đến.",
  });
  if (risks.some((r) => r.id === "gtd-missing")) {
    actions.push({
      id: "scenario-add-gtd",
      label: "Known Rule",
      text: "Bổ sung dữ liệu GTD để mở kịch bản overlay",
      rationale: "Có GTD mới đánh giá được rủi ro overlay theo từng kịch bản.",
    });
  }
  actions.push({
    id: "scenario-plan-base",
    label: "Known Rule",
    text: "Lập kế hoạch theo kịch bản Cơ sở, dự phòng cho Thận trọng",
    rationale: "Kế hoạch theo vùng phổ biến, có phương án nếu field thấp.",
  });
  return actions.slice(0, 5);
}
