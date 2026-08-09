import type {
  ClubPulseV1,
  CopilotEvidenceV1,
  DataGapV1,
  SeriesScheduleCandidateV1,
} from "./seriesCopilotContextV1";

export type ScheduleHealthStateV1 = "good" | "needs_review" | "blocked" | "insufficient_data";
export type ScheduleHealthDimensionKeyV1 =
  | "structure_completeness"
  | "demand_evidence"
  | "gtd_stress"
  | "schedule_collision"
  | "operational_feasibility"
  | "data_readiness";

export interface ScheduleHealthDimensionV1 {
  key: ScheduleHealthDimensionKeyV1;
  labelVi: string;
  state: ScheduleHealthStateV1;
  detailVi: string;
  evidenceRefs: readonly string[];
}
export interface ScheduleHealthV1 {
  version: "series-schedule-health-v1";
  overallState: ScheduleHealthStateV1;
  dimensions: readonly ScheduleHealthDimensionV1[];
  assessedOptionIds: readonly string[];
}

export interface BuildScheduleHealthV1Input {
  clubPulse: ClubPulseV1;
  candidateOptions: readonly SeriesScheduleCandidateV1[];
  dataGaps: readonly DataGapV1[];
  evidence: readonly CopilotEvidenceV1[];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function worstState(states: readonly ScheduleHealthStateV1[]): ScheduleHealthStateV1 {
  if (states.includes("blocked")) return "blocked";
  if (states.includes("insufficient_data")) return "insufficient_data";
  if (states.includes("needs_review")) return "needs_review";
  return "good";
}

function candidateEvidence(options: readonly SeriesScheduleCandidateV1[]): readonly string[] {
  return [...new Set(options.flatMap((option) => option.evidenceRefs))].sort();
}

export function buildScheduleHealthV1(input: BuildScheduleHealthV1Input): ScheduleHealthV1 {
  const options = input.candidateOptions;
  const refs = candidateEvidence(options);
  const noOptions = options.length === 0;
  const hasDemandEvidence = input.evidence.some((item) => item.metricIds.length > 0 && item.privacyState === "safe");
  const hasUsablePulse = input.clubPulse.metrics.some(
    (metric) => metric.privacyState === "safe" && metric.availability !== "unavailable",
  );
  const hasCriticalGap = input.dataGaps.some((gap) => gap.severity === "critical");
  const hasImportantGap = input.dataGaps.some((gap) => gap.severity === "important");

  const dimensions: ScheduleHealthDimensionV1[] = [
    {
      key: "structure_completeness",
      labelVi: "Độ đầy đủ cấu trúc",
      state: noOptions
        ? "insufficient_data"
        : options.every((option) => option.structureState === "complete")
          ? "good"
          : "needs_review",
      detailVi: noOptions ? "Chưa có phương án lịch để kiểm tra." : "Kiểm tra buy-in, GTD, flight và thời lượng đã khai báo.",
      evidenceRefs: refs,
    },
    {
      key: "demand_evidence",
      labelVi: "Bằng chứng nhu cầu",
      state: !hasDemandEvidence ? "insufficient_data" : hasUsablePulse ? "good" : "needs_review",
      detailVi: !hasDemandEvidence ? "Chưa có bằng chứng nhu cầu có thể kiểm tra." : "Chỉ dùng nguồn đã gắn evidence ID.",
      evidenceRefs: input.evidence.filter((item) => item.metricIds.length > 0).map((item) => item.evidenceId).sort(),
    },
    {
      key: "gtd_stress",
      labelVi: "Sức ép GTD",
      state: noOptions
        ? "insufficient_data"
        : options.every((option) => option.gtdStressState === "blocked")
          ? "blocked"
          : options.some((option) => option.gtdStressState !== "supported")
            ? "needs_review"
            : "good",
      detailVi: "Đọc trạng thái GTD đã được engine deterministic tính trước; V không tự tạo con số.",
      evidenceRefs: refs,
    },
    {
      key: "schedule_collision",
      labelVi: "Xung đột lịch",
      state: noOptions
        ? "insufficient_data"
        : options.some((option) => option.collisionState === "blocked")
          ? "blocked"
          : options.some((option) => option.collisionState !== "clear")
            ? "needs_review"
            : "good",
      detailVi: "So sánh chồng lịch đã biết; không suy diễn nguyên nhân hay mức ảnh hưởng.",
      evidenceRefs: refs,
    },
    {
      key: "operational_feasibility",
      labelVi: "Khả năng vận hành",
      state: noOptions
        ? "insufficient_data"
        : options.every((option) => option.capacityState === "blocked")
          ? "blocked"
          : options.some((option) => option.capacityState !== "feasible")
            ? "needs_review"
            : "good",
      detailVi: "Đối chiếu sức chứa và thời lượng khi dữ liệu tồn tại.",
      evidenceRefs: refs,
    },
    {
      key: "data_readiness",
      labelVi: "Độ sẵn sàng dữ liệu",
      state: hasCriticalGap ? "blocked" : hasImportantGap ? "needs_review" : "good",
      detailVi: input.dataGaps.length === 0 ? "Không có khoảng trống dữ liệu đã biết." : "Các khoảng trống được liệt kê riêng, không thay bằng số không.",
      evidenceRefs: [],
    },
  ];

  return deepFreeze({
    version: "series-schedule-health-v1",
    overallState: worstState(dimensions.map((dimension) => dimension.state)),
    dimensions,
    assessedOptionIds: options.map((option) => option.optionId).sort(),
  });
}
