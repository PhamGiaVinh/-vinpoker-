// Series Intelligence — W1 "Trợ lý Series" task deriver (PURE, client-side, testable).
//
// Turns the loaded data into (a) the fixed 8-step workflow ring and (b) up to 3 concrete "hôm nay cần
// làm gì" tasks. Descriptive/derivation only — no prediction, no DB. The component feeds a NORMALIZED
// event list + the set of event_ids that already have a forecast / a confirmed result, so this stays
// pure (the messy CSV-vs-native normalization lives in the component).

export interface AssistantEvent {
  event_id: string;
  name: string | null;
  /** ISO date/time, or null when the row has no date. */
  date: string | null;
  /** true when the event has a committed GTD (so risk/overlay is computable). */
  hasGtd: boolean;
}

export interface AssistantInput {
  /** The ACTIVE dataset the page is showing (CSV test data, or live native). */
  events: AssistantEvent[];
  /** CSV test mode → forecast/result tasks are softened (no snapshots/decisions exist for CSV). */
  isCsv: boolean;
  /** event_ids that already have a saved forecast snapshot (native only; empty in CSV). */
  forecastEventIds: Set<string>;
  /** event_ids that already have a post-event result logged (native only; empty in CSV). */
  resultEventIds: Set<string>;
  /** Is the forecast/risk step (③④⑤) actually rendered? (= FEATURES.forwardLayerMonteCarlo) */
  forwardLayerAvailable: boolean;
  /** Is the ⑥ CAPTURE console actually rendered? (= FEATURES.seriesDecisionLog) */
  captureAvailable: boolean;
  /** Injected clock (keeps this pure/testable). */
  now: Date;
}

export type AssistantTaskKind =
  | "load-data"
  | "forecast-upcoming"
  | "confirm-result"
  | "fill-gtd"
  | "weekly-review";

export type AssistantSeverity = "info" | "action" | "warning";

export interface AssistantTask {
  id: string;
  kind: AssistantTaskKind;
  severity: AssistantSeverity;
  title: string;
  detail: string;
  /** Page section id to scroll to (matches the StepSection ids). */
  targetId: string;
  ctaLabel: string;
  /** true → the CTA loads the sample dataset instead of scrolling (only on load-data). */
  loadsSample?: boolean;
}

export interface WorkflowStep {
  n: number;
  key: string;
  label: string;
  hint: string;
  /** null = happens off this page (e.g. run the event on the floor). */
  targetId: string | null;
}

/** The fixed learning loop, shown as a ring. Educational — always the same 8 steps. */
export const WORKFLOW_STEPS: WorkflowStep[] = [
  { n: 1, key: "load", label: "Nạp dữ liệu", hint: "Đưa các giải đã chạy vào để máy học.", targetId: "step-load" },
  { n: 2, key: "read", label: "Đọc số", hint: "Xem series đã qua nói gì về tiền và rủi ro.", targetId: "step-insights" },
  { n: 3, key: "schedule", label: "Lên lịch", hint: "Sinh lịch festival nháp để cân nhắc.", targetId: "step-schedule" },
  { n: 4, key: "forecast", label: "Dự báo khách", hint: "Đoán số khách + kiểm rủi ro overlay.", targetId: "step-risk" },
  { n: 5, key: "gtd", label: "Chốt GTD", hint: "Chọn mức bảo đảm theo rủi ro chấp nhận được.", targetId: "step-risk" },
  { n: 6, key: "run", label: "Chạy giải", hint: "Tổ chức thực tế trên sàn.", targetId: null },
  { n: 7, key: "confirm", label: "Xác nhận kết quả", hint: "Ghi số thật sau giải (khách, prize, bù).", targetId: "step-capture" },
  { n: 8, key: "learn", label: "Rút bài học", hint: "So dự báo với thực tế để lần sau tốt hơn.", targetId: "step-capture" },
];

const isPast = (date: string | null, now: Date): boolean => {
  if (!date) return false;
  const t = new Date(date).getTime();
  return !Number.isNaN(t) && t < now.getTime();
};
const isUpcoming = (date: string | null, now: Date): boolean => {
  if (!date) return false;
  const t = new Date(date).getTime();
  return !Number.isNaN(t) && t >= now.getTime();
};
const daysUntil = (date: string, now: Date): number =>
  Math.max(0, Math.ceil((new Date(date).getTime() - now.getTime()) / 86_400_000));

/**
 * Up to 3 prioritized "hôm nay cần làm gì" tasks. Priority: nothing loaded → an upcoming giải with no
 * forecast (time-critical, soonest first) → a finished giải with no result logged (learning loop) →
 * GTD gaps → a weekly-review fallback so the list is never empty. Honest about CSV mode (softer copy,
 * no forecast/result claims). Never invents an event or a number.
 */
export function deriveAssistantTasks(input: AssistantInput): AssistantTask[] {
  const { events, isCsv, forecastEventIds, resultEventIds, forwardLayerAvailable, captureAvailable, now } = input;

  if (events.length === 0) {
    return [
      {
        id: "load-data",
        kind: "load-data",
        severity: "info",
        title: "Chưa có dữ liệu giải nào",
        detail: "Nạp CSV các giải đã chạy, hoặc bấm để tập dượt với dữ liệu mẫu.",
        targetId: "step-load",
        ctaLabel: "Tập dượt với dữ liệu mẫu",
        loadsSample: true,
      },
    ];
  }

  const tasks: AssistantTask[] = [];

  // 1) Upcoming event with no saved forecast — soonest first (time-critical).
  const upcoming = events
    .filter((e) => isUpcoming(e.date, now))
    .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime());
  const upcomingNoForecast = isCsv ? upcoming : upcoming.filter((e) => !forecastEventIds.has(e.event_id));
  // Only steer to the forecast step if that step is actually on the page (③④⑤ gated on forwardLayerMonteCarlo).
  if (forwardLayerAvailable && upcomingNoForecast.length > 0) {
    const e = upcomingNoForecast[0];
    const d = daysUntil(e.date as string, now);
    tasks.push({
      id: `forecast-${e.event_id}`,
      kind: "forecast-upcoming",
      severity: isCsv ? "info" : "action",
      title: `${e.name ?? "Giải sắp tới"} còn ${d} ngày${isCsv ? "" : " — chưa có dự báo"}`,
      detail: isCsv
        ? "Thử chạy dự báo số khách ở Bước ④ để xem luồng hoạt động."
        : "Chạy dự báo rồi lưu lại — để sau giải chấm được đúng/sai và mở khóa hiệu chỉnh.",
      targetId: "step-risk",
      ctaLabel: "Dự báo ngay",
    });
  }

  // 2) Finished event with no result logged (native only, AND only when the ⑥ capture step is on the page).
  if (!isCsv && captureAvailable) {
    const pastNoResult = events
      .filter((e) => isPast(e.date, now) && !resultEventIds.has(e.event_id))
      .sort((a, b) => new Date(b.date as string).getTime() - new Date(a.date as string).getTime());
    if (pastNoResult.length > 0) {
      const e = pastNoResult[0];
      const extra = pastNoResult.length > 1 ? ` (+${pastNoResult.length - 1} giải khác)` : "";
      tasks.push({
        id: `confirm-${e.event_id}`,
        kind: "confirm-result",
        severity: "action",
        title: `${e.name ?? "Giải đã xong"} chưa xác nhận kết quả${extra}`,
        detail: "Ghi số khách + prize thật ở Bước ⑥ để máy học từ giải này.",
        targetId: "step-capture",
        ctaLabel: "Xác nhận kết quả",
      });
    }
  }

  // 3) GTD gaps — persistent data hole that makes risk/biên "mù".
  const gtdMissing = events.filter((e) => !e.hasGtd).length;
  if (gtdMissing > 0) {
    tasks.push({
      id: "fill-gtd",
      kind: "fill-gtd",
      severity: "warning",
      title: `${gtdMissing} giải chưa có GTD cam kết`,
      detail: "Thiếu GTD thì rủi ro bù và biên đóng góp bị tính thiếu. Đặt GTD khi tạo/sửa giải.",
      targetId: "step-insights",
      ctaLabel: "Xem chi tiết",
    });
  }

  // Fallback so the list is never empty.
  if (tasks.length === 0) {
    tasks.push({
      id: "weekly-review",
      kind: "weekly-review",
      severity: "info",
      title: "Không có việc gấp — xem lại số tuần này",
      detail: "Dành 15 phút xem Bước ② để nắm nhịp tiền và rủi ro của chuỗi.",
      targetId: "step-insights",
      ctaLabel: "Mở phần Đọc số",
    });
  }

  return tasks.slice(0, 3);
}

/**
 * Whether a ring step's target section is actually rendered on the page, so the ring never offers a
 * click that dead-scrolls. step-load/step-insights (①②) are always on; ③④⑤ ride forwardLayerMonteCarlo;
 * ⑥ rides seriesDecisionLog; the "run" step (targetId null) happens off-page.
 */
export function stepTargetAvailable(
  targetId: string | null,
  opts: { forwardLayerAvailable: boolean; captureAvailable: boolean },
): boolean {
  if (targetId === null) return false;
  if (targetId === "step-schedule" || targetId === "step-risk" || targetId === "step-export") return opts.forwardLayerAvailable;
  if (targetId === "step-capture") return opts.captureAvailable;
  return true;
}

/** Which workflow step to highlight in the ring, based on the top task. */
export function activeWorkflowStep(tasks: AssistantTask[]): number {
  const top = tasks[0]?.kind;
  switch (top) {
    case "load-data":
      return 1;
    case "forecast-upcoming":
      return 4;
    case "confirm-result":
      return 7;
    case "fill-gtd":
      return 5;
    default:
      return 2;
  }
}
