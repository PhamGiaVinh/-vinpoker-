import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  createSeriesCopilotContextV1,
  type SeriesCopilotContextV1,
} from "./seriesCopilotContextV1";
import { validateVResponseV1 } from "./seriesCopilotEvidenceValidator";
import type { VResponseValidationResultV1 } from "./seriesCopilotResponseV1";

export const SERIES_COPILOT_EDGE_ADAPTER_VERSION = "series-copilot-edge-adapter-v1" as const;
const FUNCTION_NAME = "series-intelligence-copilot";

const EDGE_FAILURE_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "RATE_LIMIT_UNAVAILABLE",
  "RATE_LIMITED",
  "CLUB_PULSE_UNAVAILABLE",
  "UNKNOWN_SELECTED_OPTION",
  "COPILOT_CONTEXT_REJECTED",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_RESPONSE_REJECTED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
] as const;

export type SeriesCopilotEdgeFailureCode = (typeof EDGE_FAILURE_CODES)[number];

export class SeriesCopilotEdgeFailure extends Error {
  readonly code: SeriesCopilotEdgeFailureCode;

  constructor(code: SeriesCopilotEdgeFailureCode) {
    super(code);
    this.name = "SeriesCopilotEdgeFailure";
    this.code = code;
  }
}

const stableId = z.string().regex(/^[a-z][a-z0-9._:-]*$/);
const utc = z.string().datetime({ offset: false });
const money = z.object({ amountMinor: z.string().regex(/^\d+$/), currency: z.literal("VND"), scale: z.literal(0) }).strict();
const metric = z.object({
  metricId: stableId,
  value: z.union([z.number(), z.string(), z.null()]),
  unit: z.enum(["count", "vnd", "minutes", "ratio", "text"]),
  availability: z.enum(["exact", "partial", "stale", "unavailable"]),
  privacyState: z.enum(["safe", "small_cohort_suppressed", "not_exportable"]),
  asOf: utc,
  sourceId: stableId,
  grain: z.string().min(1),
  definitionVersion: stableId,
  unavailableReason: z.string().min(1).optional(),
  suppressionReason: z.enum(["SMALL_COHORT_SUPPRESSED", "NOT_EXPORTABLE"]).optional(),
}).strict();
const evidence = z.object({
  evidenceId: stableId,
  labelVi: z.string().min(1).max(512),
  sourceId: stableId,
  asOf: utc,
  quality: z.enum(["owner_scoped_server_aggregate", "public_unverified"]),
  privacyState: z.enum(["safe", "small_cohort_suppressed", "not_exportable"]),
  metricIds: z.array(stableId).max(64),
}).strict();
const candidate = z.object({
  optionId: stableId,
  labelVi: z.string().min(1).max(512),
  buyIn: money,
  gtd: money,
  flights: z.number().int().positive(),
  expectedDurationMinutes: z.number().int().positive().nullable(),
  requiredField: z.number().int().nonnegative().nullable(),
  structureState: z.enum(["complete", "incomplete"]),
  capacityState: z.enum(["feasible", "blocked", "unknown"]),
  collisionState: z.enum(["clear", "needs_review", "blocked", "unknown"]),
  gtdStressState: z.enum(["supported", "limited", "blocked", "unknown"]),
  evidenceRefs: z.array(stableId).max(32),
}).strict();
const dataGap = z.object({
  dataGapId: stableId,
  titleVi: z.string().min(1).max(512),
  detailVi: z.string().min(1).max(2_048),
  severity: z.enum(["info", "important", "critical"]),
  blocksRecommendation: z.boolean(),
  requiredSourceVi: z.string().min(1).max(512),
}).strict();
const dimension = z.object({
  key: z.enum(["structure_completeness", "demand_evidence", "gtd_stress", "schedule_collision", "operational_feasibility", "data_readiness"]),
  labelVi: z.string().min(1),
  state: z.enum(["good", "needs_review", "blocked", "insufficient_data"]),
  detailVi: z.string().min(1),
  evidenceRefs: z.array(stableId).max(64),
}).strict();
const contextSchema = z.object({
  version: z.literal("series-copilot-context-v1"),
  contextHash: z.string().regex(/^[0-9a-f]{64}$/),
  asOf: utc,
  clubPulse: z.object({
    version: z.literal("series-club-pulse-v1"),
    sourceMode: z.literal("server_aggregate"),
    metrics: z.array(metric).max(64),
  }).strict(),
  scheduleHealth: z.object({
    version: z.literal("series-schedule-health-v1"),
    overallState: z.enum(["good", "needs_review", "blocked", "insufficient_data"]),
    dimensions: z.array(dimension).length(6),
    assessedOptionIds: z.array(stableId).max(12),
  }).strict(),
  candidateOptions: z.array(candidate).max(12),
  dataGaps: z.array(dataGap).max(64),
  evidence: z.array(evidence).max(64),
  privacyPolicyVersion: z.literal("series-copilot-aggregate-privacy-v1"),
}).strict();
const receiptSchema = z.object({
  provider: z.literal("gemini"),
  modelId: z.literal("gemini-3.6-flash"),
  contextHash: z.string().regex(/^[0-9a-f]{64}$/),
  promptContractVersion: z.literal("series-v-prompt-policy-v1"),
  responseContractVersion: z.literal("series-v-response-v1"),
  validatorVersion: z.literal("series-v-edge-validator-v1"),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  validationState: z.literal("accepted"),
  rateLimitScope: z.literal("actor_club_global"),
}).strict();
const envelopeSchema = z.object({ context: contextSchema, response: z.unknown(), receipt: receiptSchema }).strict();

export interface SeriesCopilotEdgeRequestV1 {
  untrustedQuestion: string;
  clubId: string;
  selectedOptionIds?: readonly string[];
  signal?: AbortSignal;
}

export interface SeriesCopilotEdgeResultV1 {
  adapterVersion: typeof SERIES_COPILOT_EDGE_ADAPTER_VERSION;
  context: SeriesCopilotContextV1;
  contextHash: string;
  validation: VResponseValidationResultV1;
  receipt: SeriesCopilotReceiptV1;
}

export interface SeriesCopilotReceiptV1 {
  provider: "gemini";
  modelId: "gemini-3.6-flash";
  contextHash: string;
  promptContractVersion: "series-v-prompt-policy-v1";
  responseContractVersion: "series-v-response-v1";
  validatorVersion: "series-v-edge-validator-v1";
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  validationState: "accepted";
  rateLimitScope: "actor_club_global";
}

export type SeriesCopilotInvokerV1 = (body: unknown, signal?: AbortSignal) => Promise<{ data: unknown; error: unknown }>;

function defaultInvoker(body: unknown, signal?: AbortSignal): Promise<{ data: unknown; error: unknown }> {
  return supabase.functions.invoke(FUNCTION_NAME, { body, signal, timeout: 15_000 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function knownEdgeFailureCode(value: unknown): SeriesCopilotEdgeFailureCode | null {
  if (typeof value !== "string") return null;
  return (EDGE_FAILURE_CODES as readonly string[]).includes(value)
    ? value as SeriesCopilotEdgeFailureCode
    : null;
}

async function readKnownEdgeFailureCode(data: unknown, error: unknown): Promise<SeriesCopilotEdgeFailureCode | null> {
  if (isRecord(data)) {
    const code = knownEdgeFailureCode(data.error);
    if (code) return code;
  }
  if (!isRecord(error) || !isRecord(error.context)) return null;
  const context = error.context;
  if (typeof context.json !== "function") return null;
  try {
    const response = typeof context.clone === "function" ? context.clone() : context;
    const body = await response.json();
    return isRecord(body) ? knownEdgeFailureCode(body.error) : null;
  } catch {
    return null;
  }
}

export async function askSeriesCopilotEdgeV1(
  request: SeriesCopilotEdgeRequestV1,
  options: { invoke?: SeriesCopilotInvokerV1; requestId?: () => string } = {},
): Promise<SeriesCopilotEdgeResultV1> {
  const question = request.untrustedQuestion.trim().normalize("NFC");
  if (question.length < 1 || question.length > 1_000) throw new Error("OWNER_QUESTION_INVALID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.clubId)) {
    throw new Error("CLUB_ID_INVALID");
  }
  const selectedOptionIds = [...(request.selectedOptionIds ?? [])].sort();
  if (selectedOptionIds.length > 12 || new Set(selectedOptionIds).size !== selectedOptionIds.length || selectedOptionIds.some((id) => !/^[a-z][a-z0-9._:-]*$/.test(id))) {
    throw new Error("OPTION_SELECTION_INVALID");
  }
  const requestId = (options.requestId ?? (() => crypto.randomUUID()))();
  const { data, error } = await (options.invoke ?? defaultInvoker)({
    version: "series-v-request-v1",
    requestId,
    clubId: request.clubId.toLowerCase(),
    question,
    selectedOptionIds,
  }, request.signal);
  if (error) {
    const code = await readKnownEdgeFailureCode(data, error);
    if (code) throw new SeriesCopilotEdgeFailure(code);
    throw new Error("COPILOT_EDGE_UNAVAILABLE");
  }
  const parsed = envelopeSchema.safeParse(data);
  if (!parsed.success) throw new Error("COPILOT_EDGE_RESPONSE_INVALID");
  const envelope = parsed.data as {
    context: SeriesCopilotContextV1;
    response: unknown;
    receipt: SeriesCopilotReceiptV1;
  };
  const rawContext = envelope.context;
  const context = await createSeriesCopilotContextV1({
    asOf: rawContext.asOf,
    clubPulse: rawContext.clubPulse,
    scheduleHealth: rawContext.scheduleHealth,
    candidateOptions: rawContext.candidateOptions,
    dataGaps: rawContext.dataGaps,
    evidence: rawContext.evidence,
  });
  if (context.contextHash !== rawContext.contextHash || envelope.receipt.contextHash !== context.contextHash) {
    throw new Error("COPILOT_CONTEXT_IDENTITY_MISMATCH");
  }
  const validation = validateVResponseV1(envelope.response, context);
  if (!validation.accepted) throw new Error("COPILOT_RESPONSE_REJECTED");
  return Object.freeze({
    adapterVersion: SERIES_COPILOT_EDGE_ADAPTER_VERSION,
    context,
    contextHash: context.contextHash,
    validation,
    receipt: Object.freeze(envelope.receipt),
  });
}
