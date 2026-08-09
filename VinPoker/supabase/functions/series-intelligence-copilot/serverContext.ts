import type {
  CopilotEvidenceV1,
  DataGapV1,
  ProviderMetricV1,
  ScheduleCandidateV1,
  ServerCopilotContextV1,
} from "./contracts.ts";

const METRIC_KEYS = [
  "clubMemberProfiles",
  "uniquePlayersToday",
  "entriesToday",
  "playersPlayingNow",
  "runningEvents",
  "openTables",
  "dealersOnDuty",
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface ApprovedScheduleInputsV1 {
  candidateOptions: readonly ScheduleCandidateV1[];
  dataGaps: readonly DataGapV1[];
  evidence: readonly CopilotEvidenceV1[];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function metric(raw: unknown, pulseAsOf: string): ProviderMetricV1 {
  const value = object(raw, "metric");
  if (typeof value.metricId !== "string" || typeof value.sourceId !== "string" || typeof value.grain !== "string" || typeof value.definitionVersion !== "string") {
    throw new Error("metric provenance is invalid");
  }
  if (value.unit !== "count" || !["exact", "partial", "stale", "unavailable"].includes(String(value.availability))) throw new Error("metric state is invalid");
  if (!["safe", "small_cohort_suppressed", "not_exportable"].includes(String(value.privacyState))) throw new Error("metric privacy is invalid");
  if (value.asOf !== pulseAsOf) throw new Error("metric asOf is invalid");
  const privacyState = value.privacyState as ProviderMetricV1["privacyState"];
  const availability = value.availability as ProviderMetricV1["availability"];
  if (availability === "unavailable" && value.value !== null) throw new Error("unavailable metric must be null");
  if (availability !== "unavailable" && (!Number.isSafeInteger(value.value) || (value.value as number) < 0)) throw new Error("metric value is invalid");
  const suppressed = availability !== "unavailable" && privacyState !== "safe";
  return Object.freeze({
    metricId: value.metricId,
    value: suppressed ? null : value.value as number | null,
    unit: "count",
    availability,
    privacyState,
    asOf: pulseAsOf,
    sourceId: value.sourceId,
    grain: value.grain,
    definitionVersion: value.definitionVersion,
    ...(availability === "unavailable" && typeof value.unavailableReason === "string" ? { unavailableReason: value.unavailableReason } : {}),
    ...(suppressed ? { suppressionReason: privacyState === "small_cohort_suppressed" ? "SMALL_COHORT_SUPPRESSED" as const : "NOT_EXPORTABLE" as const } : {}),
  });
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildServerCopilotContextV1(
  rawPulse: unknown,
  expectedClubId: string,
  scheduleInputs: ApprovedScheduleInputsV1,
): Promise<ServerCopilotContextV1> {
  const pulse = object(rawPulse, "pulse");
  if (pulse.version !== "series-club-live-pulse-v1" || typeof pulse.clubId !== "string" || !UUID.test(pulse.clubId) || pulse.clubId.toLowerCase() !== expectedClubId) {
    throw new Error("Club Pulse identity is invalid");
  }
  if (typeof pulse.asOf !== "string" || !UTC.test(pulse.asOf) || !Number.isFinite(Date.parse(pulse.asOf))) throw new Error("Club Pulse asOf is invalid");
  const metrics = METRIC_KEYS.map((key) => metric(pulse[key], pulse.asOf as string)).sort((a, b) => a.metricId.localeCompare(b.metricId));
  const pulseEvidence: CopilotEvidenceV1 = Object.freeze({
    evidenceId: "club_pulse_server",
    labelVi: "Tổng hợp vận hành CLB theo quyền owner",
    sourceId: "get_series_club_live_pulse_v1",
    asOf: pulse.asOf as string,
    quality: "owner_scoped_server_aggregate",
    privacyState: "safe",
    metricIds: Object.freeze(metrics.map((item) => item.metricId)),
  });
  const evidence = Object.freeze([pulseEvidence, ...scheduleInputs.evidence].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)));
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
  for (const option of scheduleInputs.candidateOptions) {
    for (const ref of option.evidenceRefs) if (!evidenceIds.has(ref)) throw new Error(`candidate ${option.optionId} references unknown evidence`);
  }
  const candidateOptions = Object.freeze([...scheduleInputs.candidateOptions].sort((a, b) => a.optionId.localeCompare(b.optionId)));
  const dataGaps = Object.freeze([...scheduleInputs.dataGaps].sort((a, b) => a.dataGapId.localeCompare(b.dataGapId)));
  const overallState = candidateOptions.length === 0
    ? "insufficient_data" as const
    : candidateOptions.every((option) => option.capacityState !== "blocked" && option.collisionState !== "blocked" && option.gtdStressState !== "blocked")
      ? (dataGaps.length === 0 ? "good" as const : "needs_review" as const)
      : "blocked" as const;
  const withoutHash = {
    version: "series-copilot-context-v1" as const,
    asOf: pulse.asOf as string,
    clubPulse: { version: "series-club-pulse-v1" as const, sourceMode: "server_aggregate" as const, metrics: Object.freeze(metrics) },
    scheduleHealth: {
      version: "series-schedule-health-v1" as const,
      overallState,
      assessedOptionIds: Object.freeze(candidateOptions.map((item) => item.optionId)),
    },
    candidateOptions,
    dataGaps,
    evidence,
    privacyPolicyVersion: "series-copilot-aggregate-privacy-v1" as const,
  };
  return Object.freeze({ ...withoutHash, contextHash: await sha256(withoutHash) });
}

export function unavailableScheduleInputsV1(): ApprovedScheduleInputsV1 {
  return Object.freeze({
    candidateOptions: Object.freeze([]),
    evidence: Object.freeze([]),
    dataGaps: Object.freeze([Object.freeze({
      dataGapId: "gap_approved_schedule_candidates",
      titleVi: "Chưa có phương án lịch được duyệt",
      detailVi: "V chỉ đánh giá phương án đã được engine hoặc owner chuẩn bị; trình duyệt không được tự gửi số liệu lịch.",
      severity: "critical",
      blocksRecommendation: true,
      requiredSourceVi: "Nguồn phương án lịch server-side đã kiểm định",
    })]),
  });
}
