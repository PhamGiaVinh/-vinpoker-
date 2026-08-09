import { canonicalHash } from "./provenanceHash";
import type { ScheduleHealthV1 } from "./scheduleHealthV1";

export const SERIES_COPILOT_CONTEXT_VERSION = "series-copilot-context-v1" as const;
export const SERIES_COPILOT_PRIVACY_POLICY_VERSION = "series-copilot-aggregate-privacy-v1" as const;

export type CopilotAvailabilityV1 = "exact" | "partial" | "stale" | "unavailable";
export type CopilotPrivacyStateV1 = "safe" | "small_cohort_suppressed" | "not_exportable";
export type CopilotSuppressionReasonV1 = "SMALL_COHORT_SUPPRESSED" | "NOT_EXPORTABLE";
export type CopilotMetricUnitV1 = "count" | "vnd" | "minutes" | "ratio" | "text";

export interface CopilotMetricV1 {
  metricId: string;
  value: number | string | null;
  unit: CopilotMetricUnitV1;
  availability: CopilotAvailabilityV1;
  privacyState: CopilotPrivacyStateV1;
  asOf: string;
  sourceId: string;
  grain: string;
  definitionVersion: string;
  unavailableReason?: string;
  suppressionReason?: CopilotSuppressionReasonV1;
}

export interface ClubPulseV1 {
  version: "series-club-pulse-v1";
  sourceMode: "mock_local_fixture" | "server_aggregate";
  metrics: readonly CopilotMetricV1[];
}

export interface CopilotMoneyV1 {
  amountMinor: string;
  currency: "VND";
  scale: 0;
}

export type CandidateReadinessStateV1 = "supported" | "limited" | "blocked" | "unknown";

export interface SeriesScheduleCandidateV1 {
  optionId: string;
  labelVi: string;
  buyIn: CopilotMoneyV1;
  gtd: CopilotMoneyV1;
  flights: number;
  expectedDurationMinutes: number | null;
  requiredField: number | null;
  structureState: "complete" | "incomplete";
  capacityState: "feasible" | "blocked" | "unknown";
  collisionState: "clear" | "needs_review" | "blocked" | "unknown";
  gtdStressState: CandidateReadinessStateV1;
  evidenceRefs: readonly string[];
}

export type DataGapSeverityV1 = "info" | "important" | "critical";

export interface DataGapV1 {
  dataGapId: string;
  titleVi: string;
  detailVi: string;
  severity: DataGapSeverityV1;
  blocksRecommendation: boolean;
  requiredSourceVi: string;
}

export interface CopilotEvidenceV1 {
  evidenceId: string;
  labelVi: string;
  sourceId: string;
  asOf: string;
  quality: "mock_local_fixture" | "owner_scoped_server_aggregate" | "public_unverified";
  privacyState: CopilotPrivacyStateV1;
  metricIds: readonly string[];
}

export interface SeriesCopilotContextV1 {
  version: typeof SERIES_COPILOT_CONTEXT_VERSION;
  contextHash: string;
  asOf: string;
  clubPulse: ClubPulseV1;
  scheduleHealth: ScheduleHealthV1;
  candidateOptions: readonly SeriesScheduleCandidateV1[];
  dataGaps: readonly DataGapV1[];
  evidence: readonly CopilotEvidenceV1[];
  privacyPolicyVersion: typeof SERIES_COPILOT_PRIVACY_POLICY_VERSION;
}

export interface CreateSeriesCopilotContextV1Input {
  asOf: string;
  clubPulse: ClubPulseV1;
  scheduleHealth: ScheduleHealthV1;
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

function normalizeUtcInstant(raw: string, label: string): string {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(trimmed)) {
    throw new Error(`${label} must be an explicit UTC instant`);
  }
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`);
  return parsed.toISOString();
}

function normalizeId(raw: string, label: string): string {
  const normalized = raw.trim().normalize("NFC");
  if (!/^[a-z][a-z0-9._:-]*$/.test(normalized)) {
    throw new Error(`${label} must be a stable lowercase identifier`);
  }
  return normalized;
}

function assertUniqueIds(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} contains duplicate id ${value}`);
    seen.add(value);
  }
}

function normalizeMoney(value: CopilotMoneyV1, label: string): CopilotMoneyV1 {
  if (!/^\d+$/.test(value.amountMinor)) throw new Error(`${label}.amountMinor must be a non-negative decimal string`);
  if (value.currency !== "VND" || value.scale !== 0) throw new Error(`${label} must use VND scale 0`);
  return { amountMinor: value.amountMinor.replace(/^0+(?=\d)/, ""), currency: "VND", scale: 0 };
}

function normalizeMetric(metric: CopilotMetricV1): CopilotMetricV1 {
  const metricId = normalizeId(metric.metricId, "metricId");
  const asOf = normalizeUtcInstant(metric.asOf, `${metricId}.asOf`);
  if (metric.availability === "unavailable" && metric.value !== null) {
    throw new Error(`${metricId} cannot carry a value when unavailable`);
  }
  const expectedSuppressionReason = metric.privacyState === "small_cohort_suppressed"
    ? "SMALL_COHORT_SUPPRESSED"
    : metric.privacyState === "not_exportable"
      ? "NOT_EXPORTABLE"
      : undefined;
  if (metric.availability !== "unavailable" && metric.value === null
    && metric.suppressionReason !== expectedSuppressionReason) {
    throw new Error(`${metricId} must carry a value or an explicit privacy suppression reason when available`);
  }
  if (metric.availability === "unavailable" && !metric.unavailableReason?.trim()) {
    throw new Error(`${metricId} must explain why it is unavailable`);
  }
  if (metric.availability !== "unavailable" && metric.unavailableReason !== undefined) {
    throw new Error(`${metricId}.unavailableReason is only valid when unavailable`);
  }
  if (metric.availability === "unavailable" && metric.suppressionReason !== undefined) {
    throw new Error(`${metricId}.suppressionReason is invalid when unavailable`);
  }
  if (metric.value !== null && metric.suppressionReason !== undefined) {
    throw new Error(`${metricId}.suppressionReason is only valid when the value is redacted`);
  }
  if (metric.value === null && metric.availability !== "unavailable"
    && metric.privacyState === "safe") {
    throw new Error(`${metricId} safe value cannot be redacted`);
  }
  if (typeof metric.value === "number" && (!Number.isFinite(metric.value) || metric.value < 0)) {
    throw new Error(`${metricId} must be a finite non-negative value`);
  }
  if (metric.unit === "vnd" && metric.value !== null && (typeof metric.value !== "string" || !/^\d+$/.test(metric.value))) {
    throw new Error(`${metricId} VND value must be a decimal string`);
  }
  return {
    ...metric,
    metricId,
    asOf,
    sourceId: normalizeId(metric.sourceId, `${metricId}.sourceId`),
    grain: metric.grain.trim().normalize("NFC"),
    definitionVersion: normalizeId(metric.definitionVersion, `${metricId}.definitionVersion`),
    ...(metric.unavailableReason ? { unavailableReason: metric.unavailableReason.trim().normalize("NFC") } : {}),
    ...(metric.suppressionReason ? { suppressionReason: metric.suppressionReason } : {}),
  };
}

function normalizeCandidate(candidate: SeriesScheduleCandidateV1): SeriesScheduleCandidateV1 {
  const optionId = normalizeId(candidate.optionId, "optionId");
  if (!candidate.labelVi.trim()) throw new Error(`${optionId}.labelVi must not be empty`);
  if (!Number.isInteger(candidate.flights) || candidate.flights < 1) throw new Error(`${optionId}.flights must be positive`);
  if (candidate.expectedDurationMinutes !== null && (!Number.isInteger(candidate.expectedDurationMinutes) || candidate.expectedDurationMinutes <= 0)) {
    throw new Error(`${optionId}.expectedDurationMinutes must be positive or null`);
  }
  if (candidate.requiredField !== null && (!Number.isInteger(candidate.requiredField) || candidate.requiredField < 0)) {
    throw new Error(`${optionId}.requiredField must be non-negative or null`);
  }
  const evidenceRefs = candidate.evidenceRefs.map((id) => normalizeId(id, `${optionId}.evidenceRef`)).sort();
  assertUniqueIds(evidenceRefs, `${optionId}.evidenceRefs`);
  return {
    ...candidate,
    optionId,
    labelVi: candidate.labelVi.trim().normalize("NFC"),
    buyIn: normalizeMoney(candidate.buyIn, `${optionId}.buyIn`),
    gtd: normalizeMoney(candidate.gtd, `${optionId}.gtd`),
    evidenceRefs,
  };
}

const SCHEDULE_HEALTH_DIMENSION_KEYS = [
  "structure_completeness",
  "demand_evidence",
  "gtd_stress",
  "schedule_collision",
  "operational_feasibility",
  "data_readiness",
] as const;

function normalizeScheduleHealth(
  health: ScheduleHealthV1,
  candidateIds: readonly string[],
  evidenceIds: ReadonlySet<string>,
): ScheduleHealthV1 {
  if (health.version !== "series-schedule-health-v1") throw new Error("scheduleHealth.version is invalid");

  const dimensions = health.dimensions
    .map((dimension) => ({
      ...dimension,
      labelVi: dimension.labelVi.trim().normalize("NFC"),
      detailVi: dimension.detailVi.trim().normalize("NFC"),
      evidenceRefs: dimension.evidenceRefs
        .map((id) => normalizeId(id, `${dimension.key}.evidenceRef`))
        .sort(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  assertUniqueIds(dimensions.map((dimension) => dimension.key), "scheduleHealth.dimensions");

  const actualKeys = dimensions.map((dimension) => dimension.key).sort();
  const expectedKeys = [...SCHEDULE_HEALTH_DIMENSION_KEYS].sort();
  if (actualKeys.join("|") !== expectedKeys.join("|")) {
    throw new Error("scheduleHealth must contain each required dimension exactly once");
  }
  for (const dimension of dimensions) {
    if (!dimension.labelVi || !dimension.detailVi) throw new Error(`${dimension.key} copy must not be empty`);
    assertUniqueIds(dimension.evidenceRefs, `${dimension.key}.evidenceRefs`);
    for (const evidenceRef of dimension.evidenceRefs) {
      if (!evidenceIds.has(evidenceRef)) throw new Error(`${dimension.key} references unknown evidence ${evidenceRef}`);
    }
  }

  const assessedOptionIds = health.assessedOptionIds
    .map((id) => normalizeId(id, "scheduleHealth.assessedOptionId"))
    .sort();
  assertUniqueIds(assessedOptionIds, "scheduleHealth.assessedOptionIds");
  if (assessedOptionIds.join("|") !== [...candidateIds].sort().join("|")) {
    throw new Error("scheduleHealth.assessedOptionIds must match candidate options");
  }

  return {
    version: "series-schedule-health-v1",
    overallState: health.overallState,
    dimensions,
    assessedOptionIds,
  };
}

export async function createSeriesCopilotContextV1(
  input: CreateSeriesCopilotContextV1Input,
): Promise<SeriesCopilotContextV1> {
  const asOf = normalizeUtcInstant(input.asOf, "context.asOf");
  const metrics = input.clubPulse.metrics.map(normalizeMetric).sort((a, b) => a.metricId.localeCompare(b.metricId));
  assertUniqueIds(metrics.map((metric) => metric.metricId), "clubPulse.metrics");

  const evidence = input.evidence
    .map((item) => ({
      ...item,
      evidenceId: normalizeId(item.evidenceId, "evidenceId"),
      sourceId: normalizeId(item.sourceId, `${item.evidenceId}.sourceId`),
      asOf: normalizeUtcInstant(item.asOf, `${item.evidenceId}.asOf`),
      labelVi: item.labelVi.trim().normalize("NFC"),
      metricIds: item.metricIds.map((id) => normalizeId(id, `${item.evidenceId}.metricId`)).sort(),
    }))
    .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  assertUniqueIds(evidence.map((item) => item.evidenceId), "evidence");

  const metricIds = new Set(metrics.map((metric) => metric.metricId));
  for (const item of evidence) {
    assertUniqueIds(item.metricIds, `${item.evidenceId}.metricIds`);
    for (const metricId of item.metricIds) {
      if (!metricIds.has(metricId)) throw new Error(`${item.evidenceId} references unknown metric ${metricId}`);
    }
  }

  const candidates = input.candidateOptions.map(normalizeCandidate).sort((a, b) => a.optionId.localeCompare(b.optionId));
  assertUniqueIds(candidates.map((candidate) => candidate.optionId), "candidateOptions");
  const evidenceIds = new Set(evidence.map((item) => item.evidenceId));
  for (const candidate of candidates) {
    for (const evidenceRef of candidate.evidenceRefs) {
      if (!evidenceIds.has(evidenceRef)) throw new Error(`${candidate.optionId} references unknown evidence ${evidenceRef}`);
    }
  }

  const dataGaps = input.dataGaps
    .map((gap) => ({
      ...gap,
      dataGapId: normalizeId(gap.dataGapId, "dataGapId"),
      titleVi: gap.titleVi.trim().normalize("NFC"),
      detailVi: gap.detailVi.trim().normalize("NFC"),
      requiredSourceVi: gap.requiredSourceVi.trim().normalize("NFC"),
    }))
    .sort((a, b) => a.dataGapId.localeCompare(b.dataGapId));
  assertUniqueIds(dataGaps.map((gap) => gap.dataGapId), "dataGaps");
  for (const gap of dataGaps) {
    if (!gap.titleVi || !gap.detailVi || !gap.requiredSourceVi) {
      throw new Error(`${gap.dataGapId} copy must not be empty`);
    }
  }

  const scheduleHealth = normalizeScheduleHealth(
    input.scheduleHealth,
    candidates.map((candidate) => candidate.optionId),
    evidenceIds,
  );

  const clubPulse: ClubPulseV1 = {
    version: "series-club-pulse-v1",
    sourceMode: input.clubPulse.sourceMode,
    metrics,
  };
  const identity = {
    version: SERIES_COPILOT_CONTEXT_VERSION,
    asOf,
    clubPulse,
    scheduleHealth,
    candidateOptions: candidates,
    dataGaps,
    evidence,
    privacyPolicyVersion: SERIES_COPILOT_PRIVACY_POLICY_VERSION,
  };
  const contextHash = await canonicalHash(identity);
  return deepFreeze({ ...identity, contextHash });
}
