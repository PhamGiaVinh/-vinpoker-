// Series Intelligence — Owner Command Center (Phase 1 BI, read-only, PURE).
//
// Turns the live native `SeriesEvent[]` (from `get_club_series_events` via
// `useNativeSeriesEvents`) into descriptive Business-Intelligence summaries:
// economics totals, a data-readiness score, labeled risk flags, and an owner
// action checklist.
//
// HONESTY CONTRACT (ties to the merged Club Intelligence safety contract):
//  - This is BI ("what happened / is happening"), NOT prediction. Every derived
//    insight carries exactly one label ∈ {Known Rule, Observed Pattern,
//    Hypothesis}. It NEVER emits `Model Estimate` or `Tested Finding`.
//  - Nothing is fabricated: any missing field stays null and is reported. Totals
//    that drew on incomplete data are flagged `partial`.
//  - These are descriptive, NON-AUTHORITATIVE numbers (not an accounting report,
//    not profit/P&L). GTD has no native column yet (Phase 3) → always reported
//    missing, never faked from prize_pool.
//  - ITM / Final Table / finish positions / blind structure are NOT in the RPC
//    payload and are intentionally absent here (no fabrication, no new RPC).

import type { SeriesEvent } from "./nativeData";

/** The only labels this BI surface may emit. `Model Estimate`/`Tested Finding` are never produced. */
export type InsightLabel = "Known Rule" | "Observed Pattern" | "Hypothesis";

/** Visual/severity bucket for a risk flag (maps to theme tokens in the UI). */
export type RiskSeverity = "info" | "warning" | "risk";

// ----------------------------------------------------------------------------
// Economics summary
// ----------------------------------------------------------------------------

/** One aggregated total + how complete the data behind it was (honest "≈" rendering). */
export interface MetricTotal {
  value: number;
  /** true when at least one event lacked a field that this total needed. */
  partial: boolean;
  /** events that actually contributed to `value`. */
  contributingCount: number;
  /** total events considered. */
  totalCount: number;
}

export interface SeriesEconomics {
  events: number;
  totalEntries: MetricTotal;
  uniquePlayers: MetricTotal;
  reentries: MetricTotal;
  totalBuyIn: MetricTotal; // Σ buy_in × entries (entries = confirmed total_entries, incl. re-entries)
  totalRake: MetricTotal; // Σ fee × entries
  totalPrizePool: MetricTotal; // Σ prize_pool_actual
}

/** One row for the per-event economics table. `rakeYieldPct` is derived, null when not safely derivable. */
export interface EventEconomicsRow {
  event_id: string;
  event_name: string | null;
  event_date: string | null;
  buy_in: number | null;
  fee: number | null;
  serviceFeeAmount: number | null;
  total_entries: number | null;
  unique_entries: number | null;
  reentries: number | null;
  prize_pool_actual: number | null;
  gtd: number | null; // always null until a native GTD column exists (Phase 3)
  rakeYieldPct: number | null; // fee / buy_in × 100, only when buy_in > 0 and both present
  missingFields: string[];
}

function total(values: Array<number | null>): MetricTotal {
  const present = values.filter((v): v is number => v !== null);
  const sum = present.reduce((a, b) => a + b, 0);
  return {
    value: sum,
    partial: present.length < values.length,
    contributingCount: present.length,
    totalCount: values.length,
  };
}

/** Σ over events that have BOTH factors present; partial if any event is missing either. */
function productTotal(
  events: SeriesEvent[],
  a: (e: SeriesEvent) => number | null,
  b: (e: SeriesEvent) => number | null,
): MetricTotal {
  const contributions = events.map((e) => {
    const av = a(e);
    const bv = b(e);
    return av !== null && bv !== null ? av * bv : null;
  });
  return total(contributions);
}

export function computeEconomicsSummary(events: SeriesEvent[]): SeriesEconomics {
  return {
    events: events.length,
    totalEntries: total(events.map((e) => e.total_entries)),
    uniquePlayers: total(events.map((e) => e.unique_entries)),
    reentries: total(events.map((e) => e.reentries)),
    totalBuyIn: productTotal(events, (e) => e.buy_in, (e) => e.total_entries),
    totalRake: productTotal(events, (e) => e.fee, (e) => e.total_entries),
    totalPrizePool: total(events.map((e) => e.prize_pool_actual)),
  };
}

/** Map a SeriesEvent → economics-table row, computing the safe rake-yield ratio. */
export function toEventEconomicsRow(e: SeriesEvent): EventEconomicsRow {
  const rakeYieldPct =
    e.fee !== null && e.buy_in !== null && e.buy_in > 0 ? (e.fee / e.buy_in) * 100 : null;
  return {
    event_id: e.event_id,
    event_name: e.event_name,
    event_date: e.event_date,
    buy_in: e.buy_in,
    fee: e.fee,
    serviceFeeAmount: e.serviceFeeAmount,
    total_entries: e.total_entries,
    unique_entries: e.unique_entries,
    reentries: e.reentries,
    prize_pool_actual: e.prize_pool_actual,
    gtd: e.gtd,
    rakeYieldPct,
    missingFields: e.missingFields,
  };
}

export function toEventEconomicsRows(events: SeriesEvent[]): EventEconomicsRow[] {
  return events.map(toEventEconomicsRow);
}

// ----------------------------------------------------------------------------
// Data readiness
// ----------------------------------------------------------------------------

/** Core fields an owner can fill today (GTD is excluded from the score — it has no column yet). */
const CORE_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "event_name", label: "Tên giải" },
  { key: "event_date", label: "Ngày" },
  { key: "buy_in", label: "Buy-in" },
  { key: "fee", label: "Fee (rake)" },
  { key: "prize_pool_actual", label: "Prize pool thực tế" },
  { key: "total_entries", label: "Tổng lượt entry" },
  { key: "unique_entries", label: "Người chơi (unique)" },
  { key: "reentries", label: "Re-entry" },
];

export interface ReadinessField {
  key: string;
  label: string;
  missingCount: number;
  totalCount: number;
}

export interface ReadinessResult {
  /** 0–100 coverage over CORE_FIELDS (fields an owner can actually fill today). */
  score: number;
  label: InsightLabel; // 'Observed Pattern' — a measured fact about the data
  fields: ReadinessField[];
  /** Plain-VN "what is still missing before stronger analysis". */
  missingSummary: string[];
  /** GTD has no native column yet → a structural gap, reported separately from the owner-fillable score. */
  gtdStructuralGap: boolean;
}

export function computeReadiness(events: SeriesEvent[]): ReadinessResult {
  const n = events.length;
  const fields: ReadinessField[] = CORE_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    missingCount: events.filter((e) => e.missingFields.includes(f.key)).length,
    totalCount: n,
  }));

  const totalCells = n * CORE_FIELDS.length;
  const missingCells = fields.reduce((a, f) => a + f.missingCount, 0);
  const score = totalCells === 0 ? 0 : Math.round(((totalCells - missingCells) / totalCells) * 100);

  const missingSummary: string[] = [];
  for (const f of fields) {
    if (f.missingCount > 0) {
      missingSummary.push(`${f.missingCount}/${n} giải thiếu ${f.label}`);
    }
  }
  const gtdStructuralGap = events.some((e) => e.gtd === null);
  if (gtdStructuralGap) {
    missingSummary.push("GTD chưa có cột dữ liệu (sẽ bổ sung ở Phase 3) — không suy ra từ prize pool");
  }

  return { score, label: "Observed Pattern", fields, missingSummary, gtdStructuralGap };
}

// ----------------------------------------------------------------------------
// Risk flags
// ----------------------------------------------------------------------------

export interface RiskFlag {
  id: string;
  label: InsightLabel;
  severity: RiskSeverity;
  title: string;
  message: string;
  provenance: string; // why this is shown / the rule or observation behind it
  basis: string; // sample basis, e.g. "dựa trên 6 giải"
}

/** Tunables — named so the thresholds are auditable, not magic numbers. */
const REENTRY_DEPENDENCE_RATIO = 0.35; // Σreentries / Σentries at/above this = "re-entry dependence"
const LOW_FIELD_ENTRIES = 30; // a tournament with fewer confirmed entries is "low field"
const HIGH_BUYIN_PERCENTILE = 0.75; // buy-in at/above this percentile is "high buy-in"
const CONCENTRATION_TOP_SHARE = 0.6; // top-N events holding ≥ this share of entries = "concentration"

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * (sortedAsc.length - 1)));
  return sortedAsc[idx];
}

export function computeRiskFlags(events: SeriesEvent[]): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const n = events.length;
  if (n === 0) return flags;

  // GTD missing — always (no native column yet). Observed Pattern.
  if (events.some((e) => e.gtd === null)) {
    flags.push({
      id: "gtd-missing",
      label: "Observed Pattern",
      severity: "warning",
      title: "Chưa có dữ liệu GTD",
      message: "Không thể đánh giá rủi ro overlay/ngân sách chính xác khi chưa có GTD.",
      provenance: "GTD chưa có cột trong dữ liệu VinPoker (Phase 3).",
      basis: `dựa trên ${n} giải`,
    });
  }

  // Re-entry dependence — observed ratio over events that have both counts.
  const reentrySum = events.reduce((a, e) => a + (e.reentries ?? 0), 0);
  const entrySum = events.reduce((a, e) => a + (e.total_entries ?? 0), 0);
  if (entrySum > 0) {
    const ratio = reentrySum / entrySum;
    if (ratio >= REENTRY_DEPENDENCE_RATIO) {
      flags.push({
        id: "reentry-dependence",
        label: "Observed Pattern",
        severity: "info",
        title: "Phụ thuộc re-entry cao",
        message: `Re-entry chiếm ${Math.round(ratio * 100)}% tổng lượt entry của chuỗi.`,
        provenance: "Tỷ lệ Σre-entry / Σentry quan sát từ dữ liệu.",
        basis: `dựa trên ${events.filter((e) => e.total_entries !== null).length} giải có số entry`,
      });
    }
  }

  // Low-field + high buy-in — a Hypothesis (worth a look, not a conclusion).
  const buyIns = events
    .map((e) => e.buy_in)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const highBuyInCut = percentile(buyIns, HIGH_BUYIN_PERCENTILE);
  if (highBuyInCut !== null) {
    const lowFieldHighBuyIn = events.filter(
      (e) => e.buy_in !== null && e.buy_in >= highBuyInCut && e.total_entries !== null && e.total_entries < LOW_FIELD_ENTRIES,
    );
    if (lowFieldHighBuyIn.length > 0) {
      flags.push({
        id: "low-field-high-buyin",
        label: "Hypothesis",
        severity: "warning",
        title: "Buy-in cao nhưng field thấp",
        message: `${lowFieldHighBuyIn.length} giải buy-in cao có dưới ${LOW_FIELD_ENTRIES} lượt entry — có thể cần satellite/marketing.`,
        provenance: "Buy-in ≥ phân vị 75 và entry < ngưỡng field thấp (giả thuyết, cần kiểm chứng).",
        basis: `dựa trên ${lowFieldHighBuyIn.length}/${n} giải`,
      });
    }
  }

  // Entry concentration — a few events holding most of the entries.
  const eventEntries = events
    .map((e) => e.total_entries)
    .filter((v): v is number => v !== null)
    .sort((a, b) => b - a);
  if (eventEntries.length >= 3 && entrySum > 0) {
    const topN = Math.max(1, Math.ceil(eventEntries.length * 0.25));
    const topShare = eventEntries.slice(0, topN).reduce((a, b) => a + b, 0) / entrySum;
    if (topShare >= CONCENTRATION_TOP_SHARE) {
      flags.push({
        id: "entry-concentration",
        label: "Observed Pattern",
        severity: "info",
        title: "Lượt entry tập trung ở ít giải",
        message: `Top ${topN} giải chiếm ${Math.round(topShare * 100)}% tổng lượt entry.`,
        provenance: "Phân bố entry quan sát từ dữ liệu.",
        basis: `dựa trên ${eventEntries.length} giải có số entry`,
      });
    }
  }

  return flags;
}

// ----------------------------------------------------------------------------
// Owner action checklist
// ----------------------------------------------------------------------------

export interface OwnerAction {
  id: string;
  label: InsightLabel;
  text: string;
  rationale: string;
}

/** Derive 3–7 concrete, non-guaranteeing actions from the events + risk flags. */
export function computeOwnerActionChecklist(events: SeriesEvent[], risks: RiskFlag[]): OwnerAction[] {
  const actions: OwnerAction[] = [];
  const byId = new Set(risks.map((r) => r.id));

  if (byId.has("gtd-missing")) {
    actions.push({
      id: "verify-gtd",
      label: "Known Rule",
      text: "Xác minh GTD trước khi công bố lịch giải",
      rationale: "GTD chưa có dữ liệu — cần chốt để đánh giá overlay/ngân sách.",
    });
  }
  if (byId.has("low-field-high-buyin")) {
    actions.push({
      id: "add-satellite",
      label: "Known Rule",
      text: "Thêm satellite trước các event buy-in cao",
      rationale: "Giải buy-in cao thường cần feeder để đủ field.",
    });
    actions.push({
      id: "marketing-low-field",
      label: "Hypothesis",
      text: "Đẩy marketing cho các event ít field",
      rationale: "Field thấp có thể cải thiện nếu tăng truyền thông trước D-2 (cần kiểm chứng).",
    });
  }
  if (byId.has("reentry-dependence")) {
    actions.push({
      id: "review-reentry",
      label: "Hypothesis",
      text: "Rà soát cấu trúc re-entry / late reg",
      rationale: "Chuỗi đang phụ thuộc nhiều vào re-entry — xem lại cấu trúc để ổn định doanh thu.",
    });
  }

  // General known-rule actions to keep the checklist useful (cap 7, floor 3).
  const general: OwnerAction[] = [
    {
      id: "capacity",
      label: "Known Rule",
      text: "Chuẩn bị đủ bàn & dealer cho khung giờ cao điểm",
      rationale: "Đủ capacity giúp tránh nghẽn seating khi field tăng.",
    },
    {
      id: "fill-data",
      label: "Known Rule",
      text: "Bổ sung các trường dữ liệu còn thiếu để phân tích mạnh hơn",
      rationale: "Dữ liệu đầy đủ hơn cho phép kịch bản/đối chiếu chính xác hơn.",
    },
    {
      id: "review-after",
      label: "Known Rule",
      text: "Rà soát sau series: đối chiếu entry, prize pool, fee",
      rationale: "So sánh thực tế với kế hoạch để cải thiện series sau.",
    },
  ];
  for (const g of general) {
    if (actions.length >= 7) break;
    actions.push(g);
  }

  return actions.slice(0, 7);
}
