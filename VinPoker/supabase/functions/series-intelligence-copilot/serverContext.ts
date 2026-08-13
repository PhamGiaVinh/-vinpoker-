import type {
  CopilotEvidenceV1,
  DataGapV1,
  ProviderMetricV1,
  ScheduleCandidateV1,
  ScheduleHealthDimensionV1,
  ScheduleHealthStateV1,
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
const POSTGRES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STABLE_ID = /^[a-z][a-z0-9._:-]*$/;
const MONEY = /^(0|[1-9]\d{0,15})$/;

export interface ApprovedScheduleInputsV1 {
  candidateOptions: readonly ScheduleCandidateV1[];
  dataGaps: readonly DataGapV1[];
  evidence: readonly CopilotEvidenceV1[];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} keys are invalid`);
  }
}

function stableIdArray(value: unknown, label: string, max: number): readonly string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} is invalid`);
  const ids = value.map((item) => {
    if (typeof item !== "string" || !STABLE_ID.test(item)) throw new Error(`${label} contains an invalid id`);
    return item;
  });
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicates`);
  return Object.freeze([...ids].sort());
}

function boundedText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.trim().normalize("NFC");
  if (normalized.length < 1 || normalized.length > max) throw new Error(`${label} is invalid`);
  return normalized;
}

function parseEvidence(raw: unknown): CopilotEvidenceV1 {
  const value = object(raw, "evidence");
  exactKeys(value, ["evidenceId", "labelVi", "sourceId", "asOf", "quality", "privacyState", "metricIds"], "evidence");
  if (typeof value.evidenceId !== "string" || !STABLE_ID.test(value.evidenceId)) throw new Error("evidence id is invalid");
  if (typeof value.sourceId !== "string" || !STABLE_ID.test(value.sourceId)) throw new Error("evidence source is invalid");
  if (typeof value.asOf !== "string" || !UTC.test(value.asOf) || !Number.isFinite(Date.parse(value.asOf))) throw new Error("evidence time is invalid");
  if (!['owner_scoped_server_aggregate', 'public_unverified'].includes(String(value.quality)) || value.privacyState !== "safe") throw new Error("evidence trust is invalid");
  return Object.freeze({
    evidenceId: value.evidenceId,
    labelVi: boundedText(value.labelVi, "evidence label", 512),
    sourceId: value.sourceId,
    asOf: value.asOf,
    quality: value.quality as CopilotEvidenceV1["quality"],
    privacyState: "safe",
    metricIds: stableIdArray(value.metricIds, "evidence metric ids", 64),
  });
}

function parseMoney(raw: unknown, label: string): ScheduleCandidateV1["buyIn"] {
  const value = object(raw, label);
  exactKeys(value, ["amountMinor", "currency", "scale"], label);
  if (typeof value.amountMinor !== "string" || !MONEY.test(value.amountMinor) || BigInt(value.amountMinor) > 9007199254740991n) throw new Error(`${label} amount is invalid`);
  if (value.currency !== "VND" || value.scale !== 0) throw new Error(`${label} currency is invalid`);
  return Object.freeze({ amountMinor: value.amountMinor, currency: "VND", scale: 0 });
}

function parseCandidate(raw: unknown): ScheduleCandidateV1 {
  const value = object(raw, "candidate");
  exactKeys(value, ["optionId", "labelVi", "buyIn", "gtd", "flights", "expectedDurationMinutes", "requiredField", "structureState", "capacityState", "collisionState", "gtdStressState", "evidenceRefs"], "candidate");
  if (typeof value.optionId !== "string" || !STABLE_ID.test(value.optionId)) throw new Error("candidate id is invalid");
  if (!Number.isSafeInteger(value.flights) || (value.flights as number) < 1) throw new Error("candidate flights are invalid");
  if (value.expectedDurationMinutes !== null && (!Number.isSafeInteger(value.expectedDurationMinutes) || (value.expectedDurationMinutes as number) < 1)) throw new Error("candidate duration is invalid");
  if (value.requiredField !== null && (!Number.isSafeInteger(value.requiredField) || (value.requiredField as number) < 0)) throw new Error("candidate required field is invalid");
  if (!['complete', 'incomplete'].includes(String(value.structureState))) throw new Error("candidate structure state is invalid");
  if (!['feasible', 'blocked', 'unknown'].includes(String(value.capacityState))) throw new Error("candidate capacity state is invalid");
  if (!['clear', 'needs_review', 'blocked', 'unknown'].includes(String(value.collisionState))) throw new Error("candidate collision state is invalid");
  if (!['supported', 'limited', 'blocked', 'unknown'].includes(String(value.gtdStressState))) throw new Error("candidate GTD state is invalid");
  if (value.requiredField === null && value.gtdStressState === "supported") throw new Error("candidate GTD support is forged");
  return Object.freeze({
    optionId: value.optionId,
    labelVi: boundedText(value.labelVi, "candidate label", 512),
    buyIn: parseMoney(value.buyIn, "candidate buy-in"),
    gtd: parseMoney(value.gtd, "candidate GTD"),
    flights: value.flights as number,
    expectedDurationMinutes: value.expectedDurationMinutes as number | null,
    requiredField: value.requiredField as number | null,
    structureState: value.structureState as ScheduleCandidateV1["structureState"],
    capacityState: value.capacityState as ScheduleCandidateV1["capacityState"],
    collisionState: value.collisionState as ScheduleCandidateV1["collisionState"],
    gtdStressState: value.gtdStressState as ScheduleCandidateV1["gtdStressState"],
    evidenceRefs: stableIdArray(value.evidenceRefs, "candidate evidence refs", 32),
  });
}

function parseDataGap(raw: unknown): DataGapV1 {
  const value = object(raw, "data gap");
  exactKeys(value, ["dataGapId", "titleVi", "detailVi", "severity", "blocksRecommendation", "requiredSourceVi"], "data gap");
  if (typeof value.dataGapId !== "string" || !STABLE_ID.test(value.dataGapId)) throw new Error("data gap id is invalid");
  if (!['info', 'important', 'critical'].includes(String(value.severity)) || typeof value.blocksRecommendation !== "boolean") throw new Error("data gap state is invalid");
  return Object.freeze({
    dataGapId: value.dataGapId,
    titleVi: boundedText(value.titleVi, "data gap title", 512),
    detailVi: boundedText(value.detailVi, "data gap detail", 2048),
    severity: value.severity as DataGapV1["severity"],
    blocksRecommendation: value.blocksRecommendation,
    requiredSourceVi: boundedText(value.requiredSourceVi, "data gap source", 512),
  });
}

export function parseApprovedScheduleInputsV1(raw: unknown, expectedClubId: string): ApprovedScheduleInputsV1 {
  const value = object(raw, "approved candidate response");
  exactKeys(value, ["version", "clubId", "asOf", "candidateOptions", "evidence", "dataGaps"], "approved candidate response");
  if (value.version !== "series-approved-schedule-candidates-v1" || value.clubId !== expectedClubId) throw new Error("approved candidate identity is invalid");
  if (typeof value.asOf !== "string" || !UTC.test(value.asOf) || !Number.isFinite(Date.parse(value.asOf))) throw new Error("approved candidate time is invalid");
  if (!Array.isArray(value.candidateOptions) || value.candidateOptions.length > 12 || !Array.isArray(value.evidence) || !Array.isArray(value.dataGaps)) throw new Error("approved candidate collections are invalid");
  const candidateOptions = Object.freeze(value.candidateOptions.map(parseCandidate).sort((a, b) => a.optionId.localeCompare(b.optionId)));
  const evidence = Object.freeze(value.evidence.map(parseEvidence).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)));
  const dataGaps = Object.freeze(value.dataGaps.map(parseDataGap).sort((a, b) => a.dataGapId.localeCompare(b.dataGapId)));
  if (new Set(candidateOptions.map((item) => item.optionId)).size !== candidateOptions.length) throw new Error("approved candidates contain duplicates");
  if (new Set(evidence.map((item) => item.evidenceId)).size !== evidence.length) throw new Error("approved evidence contains duplicates");
  if (new Set(dataGaps.map((item) => item.dataGapId)).size !== dataGaps.length) throw new Error("approved data gaps contain duplicates");
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
  for (const candidate of candidateOptions) for (const ref of candidate.evidenceRefs) if (!evidenceIds.has(ref)) throw new Error("candidate references unknown evidence");
  return Object.freeze({ candidateOptions, evidence, dataGaps });
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

function worstState(states: readonly ScheduleHealthStateV1[]): ScheduleHealthStateV1 {
  if (states.includes("blocked")) return "blocked";
  if (states.includes("insufficient_data")) return "insufficient_data";
  if (states.includes("needs_review")) return "needs_review";
  return "good";
}

function buildScheduleHealth(
  metrics: readonly ProviderMetricV1[],
  candidateOptions: readonly ScheduleCandidateV1[],
  dataGaps: readonly DataGapV1[],
  evidence: readonly CopilotEvidenceV1[],
): ServerCopilotContextV1["scheduleHealth"] {
  const refs = Object.freeze([...new Set(candidateOptions.flatMap((option) => option.evidenceRefs))].sort());
  const noOptions = candidateOptions.length === 0;
  const hasDemandEvidence = evidence.some((item) => item.metricIds.length > 0 && item.privacyState === "safe");
  const hasUsablePulse = metrics.some((metric) => metric.privacyState === "safe" && metric.availability !== "unavailable");
  const hasCriticalGap = dataGaps.some((gap) => gap.severity === "critical");
  const hasImportantGap = dataGaps.some((gap) => gap.severity === "important");
  const dimensions: readonly ScheduleHealthDimensionV1[] = Object.freeze([
    Object.freeze({
      key: "structure_completeness",
      labelVi: "Độ đầy đủ cấu trúc",
      state: noOptions ? "insufficient_data" : candidateOptions.every((option) => option.structureState === "complete") ? "good" : "needs_review",
      detailVi: noOptions ? "Chưa có phương án lịch để kiểm tra." : "Kiểm tra buy-in, GTD, flight và thời lượng đã khai báo.",
      evidenceRefs: refs,
    }),
    Object.freeze({
      key: "demand_evidence",
      labelVi: "Bằng chứng nhu cầu",
      state: !hasDemandEvidence ? "insufficient_data" : hasUsablePulse ? "good" : "needs_review",
      detailVi: !hasDemandEvidence ? "Chưa có bằng chứng nhu cầu có thể kiểm tra." : "Chỉ dùng nguồn đã gắn evidence ID.",
      evidenceRefs: Object.freeze(evidence.filter((item) => item.metricIds.length > 0).map((item) => item.evidenceId).sort()),
    }),
    Object.freeze({
      key: "gtd_stress",
      labelVi: "Sức ép GTD",
      state: noOptions ? "insufficient_data" : candidateOptions.every((option) => option.gtdStressState === "blocked") ? "blocked" : candidateOptions.some((option) => option.gtdStressState !== "supported") ? "needs_review" : "good",
      detailVi: "Đọc trạng thái GTD đã được engine deterministic tính trước; V không tự tạo con số.",
      evidenceRefs: refs,
    }),
    Object.freeze({
      key: "schedule_collision",
      labelVi: "Xung đột lịch",
      state: noOptions ? "insufficient_data" : candidateOptions.some((option) => option.collisionState === "blocked") ? "blocked" : candidateOptions.some((option) => option.collisionState !== "clear") ? "needs_review" : "good",
      detailVi: "So sánh chồng lịch đã biết; không suy diễn nguyên nhân hay mức ảnh hưởng.",
      evidenceRefs: refs,
    }),
    Object.freeze({
      key: "operational_feasibility",
      labelVi: "Khả năng vận hành",
      state: noOptions ? "insufficient_data" : candidateOptions.every((option) => option.capacityState === "blocked") ? "blocked" : candidateOptions.some((option) => option.capacityState !== "feasible") ? "needs_review" : "good",
      detailVi: "Đối chiếu sức chứa và thời lượng khi dữ liệu tồn tại.",
      evidenceRefs: refs,
    }),
    Object.freeze({
      key: "data_readiness",
      labelVi: "Độ sẵn sàng dữ liệu",
      state: hasCriticalGap ? "blocked" : hasImportantGap ? "needs_review" : "good",
      detailVi: dataGaps.length === 0 ? "Không có khoảng trống dữ liệu đã biết." : "Các khoảng trống được liệt kê riêng, không thay bằng số không.",
      evidenceRefs: Object.freeze([]),
    }),
  ]);
  return Object.freeze({
    version: "series-schedule-health-v1",
    overallState: worstState(dimensions.map((dimension) => dimension.state)),
    dimensions,
    assessedOptionIds: Object.freeze(candidateOptions.map((item) => item.optionId)),
  });
}

export async function buildServerCopilotContextV1(
  rawPulse: unknown,
  expectedClubId: string,
  scheduleInputs: ApprovedScheduleInputsV1,
): Promise<ServerCopilotContextV1> {
  const pulse = object(rawPulse, "pulse");
  if (pulse.version !== "series-club-live-pulse-v1" || typeof pulse.clubId !== "string" || !POSTGRES_UUID.test(pulse.clubId) || pulse.clubId.toLowerCase() !== expectedClubId) {
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
  const scheduleHealth = buildScheduleHealth(metrics, candidateOptions, dataGaps, evidence);
  const withoutHash = {
    version: "series-copilot-context-v1" as const,
    asOf: pulse.asOf as string,
    clubPulse: { version: "series-club-pulse-v1" as const, sourceMode: "server_aggregate" as const, metrics: Object.freeze(metrics) },
    scheduleHealth,
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
