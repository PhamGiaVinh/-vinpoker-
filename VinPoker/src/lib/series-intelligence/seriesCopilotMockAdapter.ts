import {
  createSeriesCopilotContextV1,
  type ClubPulseV1,
  type CopilotEvidenceV1,
  type DataGapV1,
  type SeriesCopilotContextV1,
  type SeriesScheduleCandidateV1,
} from "./seriesCopilotContextV1";
import { buildScheduleHealthV1 } from "./scheduleHealthV1";
import { validateVResponseV1 } from "./seriesCopilotEvidenceValidator";
import type { VResponseValidationResultV1 } from "./seriesCopilotResponseV1";

export const SERIES_COPILOT_MOCK_ADAPTER_VERSION = "series-copilot-mock-adapter-v1" as const;

export interface MockSeriesCopilotRequestV1 {
  untrustedQuestion: string;
  context: SeriesCopilotContextV1;
  signal?: AbortSignal;
  latencyMs?: number;
}
export interface MockSeriesCopilotResultV1 {
  adapterVersion: typeof SERIES_COPILOT_MOCK_ADAPTER_VERSION;
  contextHash: string;
  validation: VResponseValidationResultV1;
}

const MOCK_AS_OF = "2026-08-09T03:00:00.000Z";

const MOCK_PULSE: ClubPulseV1 = {
  version: "series-club-pulse-v1",
  sourceMode: "mock_local_fixture",
  metrics: [
    {
      metricId: "club_membership_records",
      value: 342,
      unit: "count",
      availability: "exact",
      privacyState: "safe",
      asOf: MOCK_AS_OF,
      sourceId: "mock_club_roster",
      grain: "membership_records_current",
      definitionVersion: "club_membership_records_v1",
    },
    {
      metricId: "club_entries_today",
      value: 128,
      unit: "count",
      availability: "exact",
      privacyState: "safe",
      asOf: MOCK_AS_OF,
      sourceId: "mock_confirmed_registrations",
      grain: "confirmed_bullets_today",
      definitionVersion: "club_entries_today_v1",
    },
    {
      metricId: "club_unique_players_today",
      value: 76,
      unit: "count",
      availability: "partial",
      privacyState: "safe",
      asOf: MOCK_AS_OF,
      sourceId: "mock_confirmed_registrations",
      grain: "distinct_canonical_players_today",
      definitionVersion: "club_unique_players_today_v1",
    },
    {
      metricId: "club_active_players",
      value: 41,
      unit: "count",
      availability: "stale",
      privacyState: "safe",
      asOf: "2026-08-09T02:45:00.000Z",
      sourceId: "mock_active_seats",
      grain: "distinct_canonical_players_with_active_seat",
      definitionVersion: "club_active_players_v1",
    },
  ],
};

const MOCK_EVIDENCE: readonly CopilotEvidenceV1[] = [
  {
    evidenceId: "mock_club_pulse",
    labelVi: "Club Pulse minh họa",
    sourceId: "mock_club_aggregate",
    asOf: MOCK_AS_OF,
    quality: "mock_local_fixture",
    privacyState: "safe",
    metricIds: ["club_active_players", "club_entries_today", "club_membership_records", "club_unique_players_today"],
  },
  {
    evidenceId: "mock_series_history",
    labelVi: "Phân bố giải lịch sử minh họa",
    sourceId: "mock_series_history",
    asOf: "2026-08-08T17:00:00.000Z",
    quality: "mock_local_fixture",
    privacyState: "safe",
    metricIds: ["club_entries_today"],
  },
  {
    evidenceId: "mock_schedule_supply",
    labelVi: "Lịch thị trường minh họa",
    sourceId: "mock_schedule_supply",
    asOf: "2026-08-08T17:00:00.000Z",
    quality: "mock_local_fixture",
    privacyState: "safe",
    metricIds: [],
  },
];

const MOCK_CANDIDATES: readonly SeriesScheduleCandidateV1[] = [
  {
    optionId: "option_balanced",
    labelVi: "Phương án cân bằng cuối tuần",
    buyIn: { amountMinor: "6600000", currency: "VND", scale: 0 },
    gtd: { amountMinor: "6000000000", currency: "VND", scale: 0 },
    flights: 2,
    expectedDurationMinutes: 1_440,
    requiredField: 1_000,
    structureState: "complete",
    capacityState: "feasible",
    collisionState: "clear",
    gtdStressState: "limited",
    evidenceRefs: ["mock_club_pulse", "mock_schedule_supply", "mock_series_history"],
  },
  {
    optionId: "option_growth",
    labelVi: "Phương án tăng trưởng",
    buyIn: { amountMinor: "8800000", currency: "VND", scale: 0 },
    gtd: { amountMinor: "9000000000", currency: "VND", scale: 0 },
    flights: 3,
    expectedDurationMinutes: 1_800,
    requiredField: 1_125,
    structureState: "complete",
    capacityState: "unknown",
    collisionState: "needs_review",
    gtdStressState: "limited",
    evidenceRefs: ["mock_club_pulse", "mock_schedule_supply", "mock_series_history"],
  },
];

const MOCK_DATA_GAPS: readonly DataGapV1[] = [
  {
    dataGapId: "gap_active_seat_freshness",
    titleVi: "Số người đang chơi chưa đủ mới",
    detailVi: "Quan sát active seat đang ở trạng thái stale nên chỉ dùng để mô tả.",
    severity: "important",
    blocksRecommendation: false,
    requiredSourceVi: "Active seat aggregate có timestamp mới hơn",
  },
  {
    dataGapId: "gap_satellite_conversion",
    titleVi: "Thiếu chuyển đổi satellite",
    detailVi: "Chưa có chuỗi awarded, redeemed và converted cùng định nghĩa.",
    severity: "important",
    blocksRecommendation: false,
    requiredSourceVi: "Satellite conversion aggregate theo event",
  },
];

export async function createMockSeriesCopilotContextV1(clubPulse: ClubPulseV1 = MOCK_PULSE): Promise<SeriesCopilotContextV1> {
  const livePulse = clubPulse.sourceMode === "server_aggregate";
  const evidence: readonly CopilotEvidenceV1[] = MOCK_EVIDENCE.map((item) => {
    if (item.evidenceId === "mock_club_pulse") {
      return {
        ...item,
        labelVi: livePulse ? "Club Pulse của CLB" : item.labelVi,
        sourceId: livePulse ? "series_club_live_pulse_v1" : item.sourceId,
        quality: livePulse ? "owner_scoped_server_aggregate" : item.quality,
        metricIds: clubPulse.metrics.map((metric) => metric.metricId),
      };
    }
    return livePulse ? { ...item, metricIds: [] } : item;
  });
  const scheduleHealth = buildScheduleHealthV1({
    clubPulse,
    candidateOptions: MOCK_CANDIDATES,
    dataGaps: MOCK_DATA_GAPS,
    evidence,
  });
  return createSeriesCopilotContextV1({
    asOf: MOCK_AS_OF,
    clubPulse,
    scheduleHealth,
    candidateOptions: MOCK_CANDIDATES,
    dataGaps: MOCK_DATA_GAPS,
    evidence,
  });
}

function waitForMockLatency(latencyMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Mock request aborted", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(resolve, Math.max(0, latencyMs));
    signal?.addEventListener("abort", () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Mock request aborted", "AbortError"));
    }, { once: true });
  });
}

export async function askMockSeriesCopilotV1(request: MockSeriesCopilotRequestV1): Promise<MockSeriesCopilotResultV1> {
  const question = request.untrustedQuestion.trim();
  if (question.length === 0 || question.length > 1_000) throw new Error("Owner question must contain between one and one thousand characters");
  await waitForMockLatency(request.latencyMs ?? 650, request.signal);

  // The untrusted question is intentionally not interpolated into facts or policy. This local adapter proves the
  // response/validation/UI seam only; a future server provider owns prompt construction and authorization.
  const rawResponse = {
    version: "series-v-response-v1",
    summaryVi: "V nghiêng về phương án cân bằng, nhưng dữ liệu hiện tại vẫn cần chủ CLB xác nhận trước khi chốt.",
    optionAssessments: [
      {
        optionId: "option_balanced",
        verdict: "supported",
        tradeoffs: [
          "GTD {{option:option_balanced:gtd}} đã nằm trong phương án được engine kiểm tra.",
          "Required field {{option:option_balanced:required_field}} cần được đối chiếu lại với sức chứa vận hành.",
        ],
        evidenceRefs: ["mock_club_pulse", "mock_schedule_supply", "mock_series_history"],
      },
      {
        optionId: "option_growth",
        verdict: "needs_review",
        tradeoffs: [
          "Phương án có {{option:option_growth:flights}} flight nhưng sức chứa hiện chưa đủ bằng chứng.",
          "GTD {{option:option_growth:gtd}} làm tăng yêu cầu field so với phương án cân bằng.",
        ],
        evidenceRefs: ["mock_club_pulse", "mock_schedule_supply", "mock_series_history"],
      },
    ],
    recommendedOptionId: "option_balanced",
    missingDataIds: ["gap_active_seat_freshness", "gap_satellite_conversion"],
    evidenceRefs: ["mock_club_pulse", "mock_schedule_supply", "mock_series_history"],
    answerStatus: "supported",
    humanDecisionRequired: true,
  };

  return Object.freeze({
    adapterVersion: SERIES_COPILOT_MOCK_ADAPTER_VERSION,
    contextHash: request.context.contextHash,
    validation: validateVResponseV1(rawResponse, request.context),
  });
}
