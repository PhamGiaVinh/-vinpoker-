import { z } from "zod";
import type {
  CopilotMetricV1,
  SeriesCopilotContextV1,
  SeriesScheduleCandidateV1,
} from "./seriesCopilotContextV1";
import {
  SERIES_V_RESPONSE_VERSION,
  blockedVResponseV1,
  type VAnswerStatusV1,
  type VResponseV1,
  type VResponseValidationResultV1,
} from "./seriesCopilotResponseV1";

export const SERIES_COPILOT_VALIDATOR_VERSION = "series-copilot-evidence-validator-v1" as const;

const stableId = z.string().regex(/^[a-z][a-z0-9._:-]*$/);
const optionAssessmentSchema = z.object({
  optionId: stableId,
  verdict: z.enum(["supported", "needs_review", "blocked", "insufficient_data"]),
  tradeoffs: z.array(z.string().min(1)).max(8),
  evidenceRefs: z.array(stableId),
}).strict();

const responseSchema = z.object({
  version: z.literal(SERIES_V_RESPONSE_VERSION),
  summaryVi: z.string().min(1).max(2_000),
  optionAssessments: z.array(optionAssessmentSchema).max(12),
  recommendedOptionId: stableId.nullable(),
  missingDataIds: z.array(stableId),
  evidenceRefs: z.array(stableId),
  answerStatus: z.enum(["supported", "limited", "blocked"]),
  humanDecisionRequired: z.literal(true),
}).strict();

const TOKEN_PATTERN = /\{\{(metric):([a-z][a-z0-9._:-]*)\}\}|\{\{option:([a-z][a-z0-9._:-]*):(buy_in|gtd|required_field|flights|duration_minutes)\}\}/g;
const ANY_TOKEN_PATTERN = /\{\{[^{}]+\}\}/g;

interface TextInspection {
  hardIssues: string[];
  limited: boolean;
}

function inspectText(text: string, context: SeriesCopilotContextV1, path: string): TextInspection {
  const hardIssues: string[] = [];
  let limited = false;
  const metrics = new Map(context.clubPulse.metrics.map((metric) => [metric.metricId, metric]));
  const options = new Map(context.candidateOptions.map((option) => [option.optionId, option]));
  const recognizedTokens = new Set<string>();

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    recognizedTokens.add(token);
    if (match[1] === "metric") {
      const metric = metrics.get(match[2]);
      if (!metric) {
        hardIssues.push(`${path}:unknown_metric_token:${match[2]}`);
        continue;
      }
      if (metric.privacyState !== "safe") hardIssues.push(`${path}:private_metric_token:${metric.metricId}`);
      if (metric.availability === "unavailable") hardIssues.push(`${path}:unavailable_metric_token:${metric.metricId}`);
      if (metric.availability === "partial" || metric.availability === "stale") limited = true;
      continue;
    }

    const option = options.get(match[3]);
    if (!option) {
      hardIssues.push(`${path}:unknown_option_token:${match[3]}`);
      continue;
    }
    const field = match[4];
    if (field === "required_field" && option.requiredField === null) hardIssues.push(`${path}:unavailable_option_field:${option.optionId}:${field}`);
    if (field === "duration_minutes" && option.expectedDurationMinutes === null) hardIssues.push(`${path}:unavailable_option_field:${option.optionId}:${field}`);
  }

  for (const token of text.match(ANY_TOKEN_PATTERN) ?? []) {
    if (!recognizedTokens.has(token)) hardIssues.push(`${path}:invalid_token:${token}`);
  }
  const withoutTokens = text.replace(ANY_TOKEN_PATTERN, "");
  if (/\d/.test(withoutTokens)) hardIssues.push(`${path}:unreferenced_numeric_literal`);
  return { hardIssues, limited };
}

function assertUnique(values: readonly string[], path: string, issues: string[]): void {
  if (new Set(values).size !== values.length) issues.push(`${path}:duplicate_reference`);
}

function determineAnswerStatus(
  response: VResponseV1,
  context: SeriesCopilotContextV1,
  textLimited: boolean,
): VAnswerStatusV1 {
  if (context.candidateOptions.length === 0 || response.optionAssessments.length === 0) return "blocked";
  if (
    textLimited ||
    response.recommendedOptionId === null ||
    response.missingDataIds.length > 0 ||
    response.optionAssessments.some((item) => item.verdict !== "supported") ||
    context.scheduleHealth.overallState !== "good" ||
    context.dataGaps.length > 0
  ) {
    return "limited";
  }
  return "supported";
}

export function validateVResponseV1(raw: unknown, context: SeriesCopilotContextV1): VResponseValidationResultV1 {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    return Object.freeze({
      accepted: false,
      response: blockedVResponseV1(),
      issues: Object.freeze(parsed.error.issues.map((issue) => `schema:${issue.path.join(".")}:${issue.code}`)),
      warnings: Object.freeze([]),
    });
  }

  // Zod is the runtime trust boundary. The project intentionally compiles without strictNullChecks, which makes
  // Zod's inferred object fields appear optional to TypeScript; after safeParse succeeds the strict schema is the
  // stronger fact, so narrow to the public contract here.
  const response = parsed.data as VResponseV1;
  const issues: string[] = [];
  const warnings: string[] = [];
  let textLimited = false;
  const evidenceById = new Map(context.evidence.map((item) => [item.evidenceId, item]));
  const evidenceIds = new Set(evidenceById.keys());
  const gapIds = new Set(context.dataGaps.map((item) => item.dataGapId));
  const optionMap = new Map(context.candidateOptions.map((item) => [item.optionId, item]));

  assertUnique(response.evidenceRefs, "evidenceRefs", issues);
  assertUnique(response.missingDataIds, "missingDataIds", issues);
  assertUnique(response.optionAssessments.map((item) => item.optionId), "optionAssessments", issues);

  for (const evidenceRef of response.evidenceRefs) {
    if (!evidenceIds.has(evidenceRef)) issues.push(`evidenceRefs:unknown:${evidenceRef}`);
    if (evidenceById.get(evidenceRef)?.privacyState !== "safe") issues.push(`evidenceRefs:private:${evidenceRef}`);
  }
  for (const dataGapId of response.missingDataIds) {
    if (!gapIds.has(dataGapId)) issues.push(`missingDataIds:unknown:${dataGapId}`);
  }

  const summaryInspection = inspectText(response.summaryVi, context, "summaryVi");
  issues.push(...summaryInspection.hardIssues);
  textLimited ||= summaryInspection.limited;

  for (const assessment of response.optionAssessments) {
    const option = optionMap.get(assessment.optionId);
    if (!option) {
      issues.push(`optionAssessments:unknown:${assessment.optionId}`);
      continue;
    }
    assertUnique(assessment.evidenceRefs, `${assessment.optionId}.evidenceRefs`, issues);
    for (const evidenceRef of assessment.evidenceRefs) {
      if (!evidenceIds.has(evidenceRef)) issues.push(`${assessment.optionId}:unknown_evidence:${evidenceRef}`);
      if (evidenceById.get(evidenceRef)?.privacyState !== "safe") issues.push(`${assessment.optionId}:private_evidence:${evidenceRef}`);
      if (!option.evidenceRefs.includes(evidenceRef)) issues.push(`${assessment.optionId}:evidence_not_on_candidate:${evidenceRef}`);
    }
    for (const [index, tradeoff] of assessment.tradeoffs.entries()) {
      const inspection = inspectText(tradeoff, context, `${assessment.optionId}.tradeoffs.${index}`);
      issues.push(...inspection.hardIssues);
      textLimited ||= inspection.limited;
    }
  }

  if (response.recommendedOptionId !== null) {
    const assessment = response.optionAssessments.find((item) => item.optionId === response.recommendedOptionId);
    if (!optionMap.has(response.recommendedOptionId)) issues.push(`recommendedOptionId:unknown:${response.recommendedOptionId}`);
    if (!assessment) issues.push(`recommendedOptionId:missing_assessment:${response.recommendedOptionId}`);
    if (assessment && (assessment.verdict === "blocked" || assessment.verdict === "insufficient_data")) {
      issues.push(`recommendedOptionId:ineligible_verdict:${response.recommendedOptionId}`);
    }
    const option = optionMap.get(response.recommendedOptionId);
    if (
      option &&
      (option.capacityState === "blocked" || option.collisionState === "blocked" || option.gtdStressState === "blocked")
    ) {
      issues.push(`recommendedOptionId:blocked_candidate:${response.recommendedOptionId}`);
    }
    if (context.scheduleHealth.overallState === "blocked") {
      issues.push("recommendedOptionId:blocked_schedule_health");
    }
    const undeclaredBlockingGaps = context.dataGaps.filter(
      (gap) => gap.blocksRecommendation && !response.missingDataIds.includes(gap.dataGapId),
    );
    for (const gap of undeclaredBlockingGaps) issues.push(`recommendedOptionId:undeclared_blocking_gap:${gap.dataGapId}`);
  }

  if (issues.length > 0) {
    return Object.freeze({
      accepted: false,
      response: blockedVResponseV1(),
      issues: Object.freeze(issues),
      warnings: Object.freeze(warnings),
    });
  }

  const derivedStatus = determineAnswerStatus(response, context, textLimited);
  if (response.answerStatus !== derivedStatus) warnings.push(`answerStatus:overridden:${response.answerStatus}->${derivedStatus}`);
  const normalized: VResponseV1 = {
    ...response,
    optionAssessments: response.optionAssessments.map((item) => Object.freeze({
      ...item,
      tradeoffs: Object.freeze([...item.tradeoffs]),
      evidenceRefs: Object.freeze([...item.evidenceRefs]),
    })),
    missingDataIds: Object.freeze([...response.missingDataIds]),
    evidenceRefs: Object.freeze([...response.evidenceRefs]),
    answerStatus: derivedStatus,
  };
  Object.freeze(normalized.optionAssessments);
  return Object.freeze({
    accepted: true,
    response: Object.freeze(normalized),
    issues: Object.freeze([]),
    warnings: Object.freeze(warnings),
  });
}

function formatMetric(metric: CopilotMetricV1): string {
  if (metric.value === null) throw new Error(`metric ${metric.metricId} is unavailable`);
  if (metric.unit === "vnd") return `${new Intl.NumberFormat("vi-VN").format(BigInt(String(metric.value)))} ₫`;
  if (metric.unit === "minutes") return `${new Intl.NumberFormat("vi-VN").format(Number(metric.value))} phút`;
  if (metric.unit === "ratio") return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(metric.value));
  if (metric.unit === "count") return new Intl.NumberFormat("vi-VN").format(Number(metric.value));
  return String(metric.value);
}

function formatMoney(amountMinor: string): string {
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(amountMinor))} ₫`;
}

function formatOptionField(option: SeriesScheduleCandidateV1, field: string): string {
  if (field === "buy_in") return formatMoney(option.buyIn.amountMinor);
  if (field === "gtd") return formatMoney(option.gtd.amountMinor);
  if (field === "required_field" && option.requiredField !== null) return new Intl.NumberFormat("vi-VN").format(option.requiredField);
  if (field === "flights") return new Intl.NumberFormat("vi-VN").format(option.flights);
  if (field === "duration_minutes" && option.expectedDurationMinutes !== null) return `${new Intl.NumberFormat("vi-VN").format(option.expectedDurationMinutes)} phút`;
  throw new Error(`option field ${field} is unavailable`);
}

export function renderValidatedCopilotText(text: string, context: SeriesCopilotContextV1): string {
  const inspection = inspectText(text, context, "render");
  if (inspection.hardIssues.length > 0) throw new Error(`refusing to render invalid copilot text: ${inspection.hardIssues.join(",")}`);
  const metrics = new Map(context.clubPulse.metrics.map((metric) => [metric.metricId, metric]));
  const options = new Map(context.candidateOptions.map((option) => [option.optionId, option]));
  return text.replace(TOKEN_PATTERN, (_token, metricKind, metricId, optionId, field) => {
    if (metricKind === "metric") return formatMetric(metrics.get(metricId) as CopilotMetricV1);
    return formatOptionField(options.get(optionId) as SeriesScheduleCandidateV1, field);
  });
}
