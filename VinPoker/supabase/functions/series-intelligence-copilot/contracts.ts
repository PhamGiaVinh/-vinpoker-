export const SERIES_V_REQUEST_VERSION = "series-v-request-v1" as const;
export const SERIES_V_RESPONSE_VERSION = "series-v-response-v1" as const;
export const SERIES_V_PROMPT_CONTRACT_VERSION = "series-v-prompt-policy-v1" as const;
export const SERIES_V_VALIDATOR_VERSION = "series-v-edge-validator-v1" as const;

export interface SeriesVRequestV1 {
  version: typeof SERIES_V_REQUEST_VERSION;
  requestId: string;
  clubId: string;
  question: string;
  selectedOptionIds: readonly string[];
}

export type Availability = "exact" | "partial" | "stale" | "unavailable";
export type PrivacyState = "safe" | "small_cohort_suppressed" | "not_exportable";

export interface ProviderMetricV1 {
  metricId: string;
  value: number | string | null;
  unit: "count" | "vnd" | "minutes" | "ratio" | "text";
  availability: Availability;
  privacyState: PrivacyState;
  asOf: string;
  sourceId: string;
  grain: string;
  definitionVersion: string;
  unavailableReason?: string;
  suppressionReason?: "SMALL_COHORT_SUPPRESSED" | "NOT_EXPORTABLE";
}

export interface ScheduleCandidateV1 {
  optionId: string;
  labelVi: string;
  buyIn: { amountMinor: string; currency: "VND"; scale: 0 };
  gtd: { amountMinor: string; currency: "VND"; scale: 0 };
  flights: number;
  expectedDurationMinutes: number | null;
  requiredField: number | null;
  structureState: "complete" | "incomplete";
  capacityState: "feasible" | "blocked" | "unknown";
  collisionState: "clear" | "needs_review" | "blocked" | "unknown";
  gtdStressState: "supported" | "limited" | "blocked" | "unknown";
  evidenceRefs: readonly string[];
}

export interface DataGapV1 {
  dataGapId: string;
  titleVi: string;
  detailVi: string;
  severity: "info" | "important" | "critical";
  blocksRecommendation: boolean;
  requiredSourceVi: string;
}

export interface CopilotEvidenceV1 {
  evidenceId: string;
  labelVi: string;
  sourceId: string;
  asOf: string;
  quality: "owner_scoped_server_aggregate" | "public_unverified";
  privacyState: PrivacyState;
  metricIds: readonly string[];
}

export interface ServerCopilotContextV1 {
  version: "series-copilot-context-v1";
  contextHash: string;
  asOf: string;
  clubPulse: {
    version: "series-club-pulse-v1";
    sourceMode: "server_aggregate";
    metrics: readonly ProviderMetricV1[];
  };
  scheduleHealth: {
    version: "series-schedule-health-v1";
    overallState: "good" | "needs_review" | "blocked" | "insufficient_data";
    assessedOptionIds: readonly string[];
  };
  candidateOptions: readonly ScheduleCandidateV1[];
  dataGaps: readonly DataGapV1[];
  evidence: readonly CopilotEvidenceV1[];
  privacyPolicyVersion: "series-copilot-aggregate-privacy-v1";
}

export interface VOptionAssessmentV1 {
  optionId: string;
  verdict: "supported" | "needs_review" | "blocked" | "insufficient_data";
  tradeoffs: readonly string[];
  evidenceRefs: readonly string[];
}

export interface VResponseV1 {
  version: typeof SERIES_V_RESPONSE_VERSION;
  summaryVi: string;
  optionAssessments: readonly VOptionAssessmentV1[];
  recommendedOptionId: string | null;
  missingDataIds: readonly string[];
  evidenceRefs: readonly string[];
  answerStatus: "supported" | "limited" | "blocked";
  humanDecisionRequired: true;
}

export interface SafeProviderReceiptV1 {
  provider: "gemini";
  modelId: string;
  contextHash: string;
  promptContractVersion: typeof SERIES_V_PROMPT_CONTRACT_VERSION;
  responseContractVersion: typeof SERIES_V_RESPONSE_VERSION;
  validatorVersion: typeof SERIES_V_VALIDATOR_VERSION;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  validationState: "accepted" | "rejected";
  rateLimitScope: "actor_club_global";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STABLE_ID = /^[a-z][a-z0-9._:-]*$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[], label: string): void {
  const allow = new Set(allowed);
  for (const key of Object.keys(value)) if (!allow.has(key)) throw new Error(`${label}.${key} is not allowed`);
  for (const key of required) if (!(key in value)) throw new Error(`${label}.${key} is required`);
}

function stableIds(value: unknown, label: string, max: number): readonly string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must be a bounded array`);
  const ids = value.map((item) => {
    if (typeof item !== "string" || !STABLE_ID.test(item)) throw new Error(`${label} contains an invalid id`);
    return item;
  });
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicates`);
  return Object.freeze([...ids].sort());
}

export function parseSeriesVRequestV1(value: unknown): SeriesVRequestV1 {
  const input = record(value, "request");
  exactKeys(input, ["version", "requestId", "clubId", "question", "selectedOptionIds"], ["version", "requestId", "clubId", "question"], "request");
  if (input.version !== SERIES_V_REQUEST_VERSION) throw new Error("request.version is invalid");
  if (typeof input.requestId !== "string" || !UUID.test(input.requestId)) throw new Error("request.requestId is invalid");
  if (typeof input.clubId !== "string" || !UUID.test(input.clubId)) throw new Error("request.clubId is invalid");
  if (typeof input.question !== "string") throw new Error("request.question is invalid");
  const question = input.question.trim().normalize("NFC");
  if (question.length < 1 || question.length > 1_000) throw new Error("request.question must contain 1-1000 characters");
  return Object.freeze({
    version: SERIES_V_REQUEST_VERSION,
    requestId: input.requestId.toLowerCase(),
    clubId: input.clubId.toLowerCase(),
    question,
    selectedOptionIds: input.selectedOptionIds === undefined
      ? Object.freeze([])
      : stableIds(input.selectedOptionIds, "request.selectedOptionIds", 12),
  });
}

function parseStringArray(value: unknown, label: string, max: number): readonly string[] {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || item.trim().length < 1)) {
    throw new Error(`${label} must be a bounded non-empty string array`);
  }
  return Object.freeze(value.map((item) => (item as string).trim().normalize("NFC")));
}

const TOKEN = /\{\{metric:([a-z][a-z0-9._:-]*)\}\}|\{\{option:([a-z][a-z0-9._:-]*):(buy_in|gtd|required_field|flights|duration_minutes)\}\}/g;
const ANY_TOKEN = /\{\{[^{}]+\}\}/g;

function validateText(text: string, context: ServerCopilotContextV1, label: string): { limited: boolean } {
  const metrics = new Map(context.clubPulse.metrics.map((item) => [item.metricId, item]));
  const options = new Map(context.candidateOptions.map((item) => [item.optionId, item]));
  const known = new Set<string>();
  let limited = false;
  for (const match of text.matchAll(TOKEN)) {
    known.add(match[0]);
    if (match[1]) {
      const metric = metrics.get(match[1]);
      if (!metric) throw new Error(`${label} references unknown metric`);
      if (metric.privacyState !== "safe" || metric.value === null) throw new Error(`${label} references protected metric`);
      if (metric.availability !== "exact") limited = true;
    } else {
      const option = options.get(match[2]);
      if (!option) throw new Error(`${label} references unknown option`);
      if (match[3] === "required_field" && option.requiredField === null) throw new Error(`${label} references unavailable option field`);
      if (match[3] === "duration_minutes" && option.expectedDurationMinutes === null) throw new Error(`${label} references unavailable option field`);
    }
  }
  for (const token of text.match(ANY_TOKEN) ?? []) if (!known.has(token)) throw new Error(`${label} contains invalid token`);
  if (/\d/.test(text.replace(ANY_TOKEN, ""))) throw new Error(`${label} contains unreferenced numeric literal`);
  return { limited };
}

export function validateProviderResponseV1(value: unknown, context: ServerCopilotContextV1): VResponseV1 {
  const raw = record(value, "response");
  exactKeys(raw, ["version", "summaryVi", "optionAssessments", "recommendedOptionId", "missingDataIds", "evidenceRefs", "answerStatus", "humanDecisionRequired"], ["version", "summaryVi", "optionAssessments", "recommendedOptionId", "missingDataIds", "evidenceRefs", "answerStatus", "humanDecisionRequired"], "response");
  if (raw.version !== SERIES_V_RESPONSE_VERSION || raw.humanDecisionRequired !== true) throw new Error("response contract is invalid");
  if (typeof raw.summaryVi !== "string" || raw.summaryVi.trim().length < 1 || raw.summaryVi.length > 2_000) throw new Error("response.summaryVi is invalid");
  if (!Array.isArray(raw.optionAssessments) || raw.optionAssessments.length > 12) throw new Error("response.optionAssessments is invalid");
  const optionIds = new Set(context.candidateOptions.map((item) => item.optionId));
  const evidenceIds = new Set(context.evidence.filter((item) => item.privacyState === "safe").map((item) => item.evidenceId));
  const gapIds = new Set(context.dataGaps.map((item) => item.dataGapId));
  let limited = validateText(raw.summaryVi.trim(), context, "summaryVi").limited;
  const assessments = raw.optionAssessments.map((item, index): VOptionAssessmentV1 => {
    const assessment = record(item, `optionAssessments.${index}`);
    exactKeys(assessment, ["optionId", "verdict", "tradeoffs", "evidenceRefs"], ["optionId", "verdict", "tradeoffs", "evidenceRefs"], `optionAssessments.${index}`);
    if (typeof assessment.optionId !== "string" || !optionIds.has(assessment.optionId)) throw new Error("assessment references unknown option");
    if (!["supported", "needs_review", "blocked", "insufficient_data"].includes(String(assessment.verdict))) throw new Error("assessment verdict is invalid");
    const tradeoffs = parseStringArray(assessment.tradeoffs, `${assessment.optionId}.tradeoffs`, 8);
    for (const tradeoff of tradeoffs) limited ||= validateText(tradeoff, context, `${assessment.optionId}.tradeoff`).limited;
    const refs = stableIds(assessment.evidenceRefs, `${assessment.optionId}.evidenceRefs`, 32);
    for (const ref of refs) if (!evidenceIds.has(ref)) throw new Error("assessment references unknown or protected evidence");
    const option = context.candidateOptions.find((candidate) => candidate.optionId === assessment.optionId) as ScheduleCandidateV1;
    for (const ref of refs) if (!option.evidenceRefs.includes(ref)) throw new Error("assessment evidence is not attached to option");
    return Object.freeze({ optionId: assessment.optionId, verdict: assessment.verdict as VOptionAssessmentV1["verdict"], tradeoffs, evidenceRefs: refs });
  });
  if (new Set(assessments.map((item) => item.optionId)).size !== assessments.length) throw new Error("response contains duplicate assessments");
  const missingDataIds = stableIds(raw.missingDataIds, "response.missingDataIds", 64);
  for (const id of missingDataIds) if (!gapIds.has(id)) throw new Error("response references unknown data gap");
  const evidenceRefs = stableIds(raw.evidenceRefs, "response.evidenceRefs", 64);
  for (const id of evidenceRefs) if (!evidenceIds.has(id)) throw new Error("response references unknown or protected evidence");
  if (raw.recommendedOptionId !== null && (typeof raw.recommendedOptionId !== "string" || !optionIds.has(raw.recommendedOptionId))) {
    throw new Error("response recommends unknown option");
  }
  if (raw.recommendedOptionId !== null) {
    const candidate = context.candidateOptions.find((item) => item.optionId === raw.recommendedOptionId) as ScheduleCandidateV1;
    const assessment = assessments.find((item) => item.optionId === raw.recommendedOptionId);
    if (!assessment || ["blocked", "insufficient_data"].includes(assessment.verdict)) throw new Error("recommended option is not eligible");
    if (candidate.capacityState === "blocked" || candidate.collisionState === "blocked" || candidate.gtdStressState === "blocked") throw new Error("recommended option is blocked");
    for (const gap of context.dataGaps) if (gap.blocksRecommendation && !missingDataIds.includes(gap.dataGapId)) throw new Error("blocking data gap is undeclared");
    if (context.scheduleHealth.overallState === "blocked" || context.scheduleHealth.overallState === "insufficient_data") throw new Error("schedule health blocks recommendation");
  }
  const answerStatus = raw.recommendedOptionId === null || limited || missingDataIds.length > 0 || context.dataGaps.length > 0 || assessments.some((item) => item.verdict !== "supported")
    ? (assessments.length === 0 ? "blocked" : "limited")
    : "supported";
  return Object.freeze({
    version: SERIES_V_RESPONSE_VERSION,
    summaryVi: raw.summaryVi.trim().normalize("NFC"),
    optionAssessments: Object.freeze(assessments),
    recommendedOptionId: raw.recommendedOptionId as string | null,
    missingDataIds,
    evidenceRefs,
    answerStatus,
    humanDecisionRequired: true,
  });
}

export function blockedVResponseV1(): VResponseV1 {
  return Object.freeze({
    version: SERIES_V_RESPONSE_VERSION,
    summaryVi: "V chưa thể tạo câu trả lời có đủ bằng chứng.",
    optionAssessments: Object.freeze([]),
    recommendedOptionId: null,
    missingDataIds: Object.freeze([]),
    evidenceRefs: Object.freeze([]),
    answerStatus: "blocked",
    humanDecisionRequired: true,
  });
}
