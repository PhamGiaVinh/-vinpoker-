// Series Intelligence — Owner Report / Pilot Pack (Phase 9, read-only, PURE).
//
// Assembles a "Series Health Report" by REUSING the S1/S2 helpers — it computes
// no new economics. Output is a screenshot/pilot-friendly summary the owner can
// show to partners.
//
// HONESTY CONTRACT (ties to the merged Club Intelligence safety contract):
//  - Labels are only Known Rule / Observed Pattern / Hypothesis. Never
//    `Model Estimate` / `Tested Finding`.
//  - "Opportunities" are observed facts or labelled hypotheses, never promises.
//  - Economics are descriptive "volume tham khảo", not revenue/profit.
//  - Deterministic: this module uses NO clock (the rendered timestamp lives in
//    the component, not here).

import type { SeriesEvent } from "./nativeData";
import {
  computeEconomicsSummary,
  computeReadiness,
  computeRiskFlags,
  type InsightLabel,
  type RiskFlag,
  type RiskSeverity,
  type SeriesEconomics,
} from "./commandCenter";
import { computeScenarioOutlook, type ScenarioOutlookResult } from "./scenarioOutlook";

export interface ReportItem {
  text: string;
  label: InsightLabel;
  detail?: string;
}

export interface ActionPhase {
  phase: string;
  items: ReportItem[];
}

export interface LabelLegendEntry {
  label: InsightLabel;
  meaning: string;
}

export interface SeriesReport {
  available: boolean;
  executive: {
    readinessScore: number;
    dataQualityNote: string;
    topRisks: RiskFlag[]; // ≤3, severity-sorted with stable id tie-breaker
    topOpportunities: ReportItem[]; // ≤3, labelled (Observed Pattern / Hypothesis)
  };
  economics: SeriesEconomics; // reused descriptive totals (volume tham khảo)
  riskRegister: RiskFlag[]; // full risk list
  actionPlan: ActionPhase[]; // 5 phases, item labels vary by source
  honestBoundary: {
    labelsLegend: LabelLegendEntry[];
    missingData: string[]; // de-duplicated
    disclaimer: string;
  };
}

const DISCLAIMER =
  "Tổng hợp từ dữ liệu quan sát & quy tắc vận hành — không phải dự đoán, không phải báo cáo kế toán, không hứa lợi nhuận.";

const LABELS_LEGEND: LabelLegendEntry[] = [
  { label: "Known Rule", meaning: "Quy tắc vận hành đã biết" },
  { label: "Observed Pattern", meaning: "Đo trực tiếp từ dữ liệu của CLB" },
  { label: "Hypothesis", meaning: "Giả thuyết — cần kiểm chứng, không phải kết luận" },
];

const SEVERITY_RANK: Record<RiskSeverity, number> = { risk: 0, warning: 1, info: 2 };

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

/** ≤3 honest opportunities; each item is skipped when its data is missing. */
function buildOpportunities(events: SeriesEvent[], scenario: ScenarioOutlookResult): ReportItem[] {
  const items: ReportItem[] = [];
  const r0 = (x: number) => Math.round(x);

  if (scenario.available) {
    const base = scenario.scenarios.find((s) => s.kind === "base");
    const up = scenario.scenarios.find((s) => s.kind === "upside");
    if (base) {
      items.push({
        text: `Vùng entry ổn định ~ ${r0(base.entryRange.low)}–${r0(base.entryRange.high)} lượt/event`,
        label: "Observed Pattern",
        detail: "Theo các event tương tự đã ghi nhận.",
      });
    }
    if (up && base && up.entryRange.high > base.entryRange.high) {
      items.push({
        text: `Dư địa Upside tới ~ ${r0(up.entryRange.high)} lượt/event`,
        label: "Hypothesis",
        detail: "Giả thuyết — cần field/marketing thuận lợi; chặn ở mức cao nhất đã ghi nhận.",
      });
    }
  }

  const withEntries = events.filter((e) => e.total_entries !== null);
  if (withEntries.length > 0) {
    const top = withEntries.reduce((a, b) => ((b.total_entries ?? 0) > (a.total_entries ?? 0) ? b : a));
    items.push({
      text: `Field lớn nhất: ${top.event_name ?? "—"} (${top.total_entries} lượt)`,
      label: "Observed Pattern",
    });
  }

  return items.slice(0, 3);
}

/** 5-phase plan; item labels vary by source (Known Rule / Observed Pattern / Hypothesis). */
function buildActionPlan(risks: RiskFlag[], scenario: ScenarioOutlookResult): ActionPhase[] {
  const hasGtdGap = risks.some((r) => r.id === "gtd-missing");
  const hasReentry = risks.some((r) => r.id === "reentry-dependence");
  const hasConcentration = risks.some((r) => r.id === "entry-concentration");
  const hasUpside = scenario.available && scenario.scenarios.some((s) => s.kind === "upside");

  const phase1: ReportItem[] = [{ text: "Chốt cấu trúc giải & lịch công bố", label: "Known Rule" }];
  if (hasGtdGap) {
    phase1.push({
      text: "Xác minh GTD trước khi công bố",
      label: "Known Rule",
      detail: "Thiếu dữ liệu GTD — cần chốt để đánh giá overlay.",
    });
  }
  if (hasConcentration) {
    phase1.push({ text: "Cân đối lịch để tránh dồn entry vào ít event", label: "Observed Pattern" });
  }

  const phase2: ReportItem[] = [{ text: "Khởi động marketing & mở satellite (nếu có)", label: "Known Rule" }];
  if (hasUpside) {
    phase2.push({ text: "Đẩy truyền thông để hướng kịch bản Upside", label: "Hypothesis" });
  }

  const phase3: ReportItem[] = [{ text: "Nhắc đăng ký, chốt seating & nhân sự sàn", label: "Known Rule" }];
  if (hasReentry) {
    phase3.push({
      text: "Rà soát cấu trúc re-entry / late reg",
      label: "Observed Pattern",
      detail: "Chuỗi đang phụ thuộc nhiều vào re-entry.",
    });
  }

  const phase4: ReportItem[] = [
    { text: "Chuẩn bị đủ bàn & dealer cho khung giờ cao điểm", label: "Known Rule" },
    { text: "Theo dõi entry thực tế so với kịch bản Cơ sở", label: "Known Rule" },
  ];

  const phase5: ReportItem[] = [
    { text: "Đối chiếu entry / prize pool / fee thực tế", label: "Known Rule" },
    { text: "Ghi nhận dữ liệu đầy đủ để báo cáo sau mạnh hơn", label: "Known Rule" },
  ];

  return [
    { phase: "Trước khi công bố", items: phase1 },
    { phase: "D-7", items: phase2 },
    { phase: "D-3", items: phase3 },
    { phase: "Ngày event", items: phase4 },
    { phase: "Sau series", items: phase5 },
  ];
}

/** Build the full owner report. On no events, returns the FULL shape with available:false (no crash). */
export function buildSeriesReport(events: SeriesEvent[]): SeriesReport {
  const economics = computeEconomicsSummary(events);
  const readiness = computeReadiness(events);
  const risks = computeRiskFlags(events);
  const scenario = computeScenarioOutlook(events, economics, readiness, risks);
  // Merge readiness + scenario missing-data, de-duped. Readiness already carries the
  // GTD note, so drop the scenario's GTD note to avoid a near-duplicate "GTD" line.
  const missingData = dedupe([
    ...readiness.missingSummary,
    ...scenario.missingDataNotes.filter((n) => !n.includes("GTD")),
  ]);

  if (events.length === 0) {
    return {
      available: false,
      executive: {
        readinessScore: 0,
        dataQualityNote: "Chưa có giải nào — không đủ dữ liệu để lập báo cáo.",
        topRisks: [],
        topOpportunities: [],
      },
      economics, // computeEconomicsSummary([]) → safe zeroed totals
      riskRegister: [],
      actionPlan: [],
      honestBoundary: { labelsLegend: LABELS_LEGEND, missingData, disclaimer: DISCLAIMER },
    };
  }

  const topRisks = [...risks]
    .sort((a, b) => {
      const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      return s !== 0 ? s : a.id.localeCompare(b.id);
    })
    .slice(0, 3);

  return {
    available: true,
    executive: {
      readinessScore: readiness.score,
      dataQualityNote: `Mức độ sẵn sàng dữ liệu ${readiness.score}% trên ${events.length} giải.`,
      topRisks,
      topOpportunities: buildOpportunities(events, scenario),
    },
    economics,
    riskRegister: risks,
    actionPlan: buildActionPlan(risks, scenario),
    honestBoundary: { labelsLegend: LABELS_LEGEND, missingData, disclaimer: DISCLAIMER },
  };
}
