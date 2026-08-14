import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

// These RPCs are intentionally isolated from generated Supabase types until the
// owner-gated migration is applied and a narrow type-sync can be verified.
// The browser receives only strict, versioned server responses.
const candidateAuthoringClient = supabase as unknown as SupabaseClient;

export const SERIES_CANDIDATE_AUTHORING_RPC = Object.freeze({
  listSources: "series_list_schedule_candidate_sources_v1",
  preview: "series_preview_schedule_candidate_v1",
  approveFromTournament: "series_approve_schedule_candidate_from_tournament_v1",
  approvedReadback: "series_get_approved_schedule_candidates_v1",
} as const);

const POSTGRES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stableId = z.string().regex(/^[a-z][a-z0-9._:-]{0,127}$/);
const utcMillis = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const nonNegativeMinor = z.string().regex(/^\d+$/);
const positiveMinor = z.string().regex(/^[1-9]\d*$/);
const money = z.object({
  amountMinor: nonNegativeMinor,
  currency: z.literal("VND"),
  scale: z.literal(0),
}).strict();

const sourceSchema = z.object({
  tournamentId: z.string().regex(POSTGRES_UUID),
  labelVi: z.string().min(1).max(512),
  scheduledStartAt: utcMillis,
  optionId: stableId,
}).strict();

const sourcesEnvelopeSchema = z.object({
  version: z.literal("series-v-candidate-authoring-sources-v1"),
  clubId: z.string().regex(POSTGRES_UUID),
  asOf: utcMillis,
  sources: z.array(sourceSchema).max(50),
}).strict();

const fieldSource = z.enum(["club_schedule", "owner_input", "deterministic", "missing"]);
const field = <T extends z.ZodTypeAny>(value: T) => z.object({ value, source: fieldSource }).strict();

const previewSchema = z.object({
  version: z.literal("series-v-candidate-authoring-preview-v1"),
  clubId: z.string().regex(POSTGRES_UUID),
  tournamentId: z.string().regex(POSTGRES_UUID),
  optionId: stableId,
  asOf: utcMillis,
  state: z.enum(["ready", "blocked"]),
  blockers: z.array(stableId).max(16),
  fields: z.object({
    eventName: field(z.string().min(1).max(512)),
    scheduledStartAt: field(utcMillis.nullable()),
    buyInVnd: field(nonNegativeMinor.nullable()),
    scheduleGtdVnd: field(nonNegativeMinor.nullable()),
    feeVnd: field(nonNegativeMinor.nullable()),
    serviceFeeVnd: field(nonNegativeMinor.nullable()),
    prizeContributionPerEntryVnd: field(positiveMinor.nullable()),
    flights: field(z.number().int().min(1).max(1_000).nullable()),
    expectedDurationMinutes: field(z.number().int().min(1).max(100_000).nullable()),
    structureState: field(z.literal("incomplete")),
    capacityState: field(z.literal("unknown")),
    collisionState: field(z.literal("unknown")),
  }).strict(),
}).strict();

const approvalSchema = z.object({
  version: z.literal("series-schedule-candidate-approval-v1"),
  candidateId: z.string().regex(POSTGRES_UUID),
  optionId: stableId,
  revision: z.number().int().min(1),
  lifecycle: z.literal("approved"),
  sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const approvedCandidateSchema = z.object({
  optionId: stableId,
  labelVi: z.string().min(1).max(512),
  buyIn: money,
  gtd: money,
  flights: z.number().int().min(1),
  expectedDurationMinutes: z.number().int().nullable(),
  requiredField: z.number().int().nonnegative().nullable(),
  structureState: z.enum(["complete", "incomplete"]),
  capacityState: z.enum(["feasible", "blocked", "unknown"]),
  collisionState: z.enum(["clear", "needs_review", "blocked", "unknown"]),
  gtdStressState: z.enum(["supported", "limited", "blocked", "unknown"]),
  evidenceRefs: z.array(stableId).max(32),
}).strict();

const approvedReadbackSchema = z.object({
  version: z.literal("series-approved-schedule-candidates-v1"),
  clubId: z.string().regex(POSTGRES_UUID),
  asOf: utcMillis,
  candidateOptions: z.array(approvedCandidateSchema).max(12),
  evidence: z.array(z.object({
    evidenceId: stableId,
    labelVi: z.string().min(1).max(512),
    sourceId: stableId,
    asOf: utcMillis,
    quality: z.enum(["owner_scoped_server_aggregate", "public_unverified"]),
    privacyState: z.literal("safe"),
    metricIds: z.array(stableId).max(64),
  }).strict()).max(64),
  dataGaps: z.array(z.object({
    dataGapId: stableId,
    titleVi: z.string().min(1).max(512),
    detailVi: z.string().min(1).max(2_048),
    severity: z.enum(["info", "important", "critical"]),
    blocksRecommendation: z.boolean(),
    requiredSourceVi: z.string().min(1).max(512),
  }).strict()).max(64),
}).strict();

export type SeriesCandidateAuthoringSource = z.infer<typeof sourceSchema>;
export type SeriesCandidateAuthoringPreview = z.infer<typeof previewSchema>;
export type SeriesCandidateAuthoringApproval = z.infer<typeof approvalSchema>;
export type SeriesCandidateAuthoringApprovedReadback = z.infer<typeof approvedCandidateSchema>;

export type SeriesCandidateAuthoringRpcError =
  | "invalid_request"
  | "forbidden"
  | "backend_unavailable"
  | "rpc_error"
  | "malformed_response"
  | "readback_mismatch";

export type SeriesCandidateAuthoringRpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SeriesCandidateAuthoringRpcError; readonly retryable: boolean };

export interface ApproveSeriesCandidateFromTournamentRequest {
  readonly clubId: string;
  readonly tournamentId: string;
  readonly gtdVnd: number;
  readonly prizeContributionPerEntryVnd: number | null;
  readonly flights: number;
  readonly expectedDurationMinutes: number | null;
}

export interface ApprovedSeriesCandidateFromTournament {
  readonly approval: SeriesCandidateAuthoringApproval;
  readonly candidate: SeriesCandidateAuthoringApprovedReadback;
}

function classifyRpcError(error: { code?: string; message?: string; status?: number } | null): Exclude<SeriesCandidateAuthoringRpcResult<never>, { ok: true }> {
  if (!error) return { ok: false, error: "malformed_response", retryable: false };
  if (error.code === "42501") return { ok: false, error: "forbidden", retryable: false };
  if (["42P01", "42883", "PGRST202", "PGRST205", "404"].includes(error.code ?? "") || /does not exist|could not find|schema cache/i.test(error.message ?? "")) {
    return { ok: false, error: "backend_unavailable", retryable: false };
  }
  const retryable = [408, 429, 502, 503, 504].includes(error.status ?? Number.NaN)
    || /network|fetch|timeout|timed out|aborted|temporarily unavailable|gateway/i.test(error.message ?? "");
  return { ok: false, error: "rpc_error", retryable };
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPostgresUuid(value: string): boolean {
  // Request validation gets an independent matcher instead of reusing a schema matcher.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseEnvelope<T>(schema: z.ZodType<T>, value: unknown): SeriesCandidateAuthoringRpcResult<T> {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "malformed_response", retryable: false };
}

export function parseSeriesCandidateAuthoringSources(value: unknown): SeriesCandidateAuthoringRpcResult<ReadonlyArray<SeriesCandidateAuthoringSource>> {
  const parsed = parseEnvelope(sourcesEnvelopeSchema, value);
  return parsed.ok ? { ok: true, value: Object.freeze([...parsed.value.sources]) } : parsed;
}

export function parseSeriesCandidateAuthoringPreview(value: unknown): SeriesCandidateAuthoringRpcResult<SeriesCandidateAuthoringPreview> {
  return parseEnvelope(previewSchema, value);
}

export async function listSeriesCandidateAuthoringSources(clubId: string): Promise<SeriesCandidateAuthoringRpcResult<ReadonlyArray<SeriesCandidateAuthoringSource>>> {
  if (!isPostgresUuid(clubId)) return { ok: false, error: "invalid_request", retryable: false };
  try {
    const { data, error } = await candidateAuthoringClient.rpc(SERIES_CANDIDATE_AUTHORING_RPC.listSources, { p_club_id: clubId });
    if (error) return classifyRpcError(error);
    const parsed = parseEnvelope(sourcesEnvelopeSchema, data);
    if (!parsed.ok || parsed.value.clubId !== clubId || !parsed.value.sources.every((source) => source.tournamentId && source.optionId.startsWith("tournament:"))) {
      return { ok: false, error: "malformed_response", retryable: false };
    }
    return { ok: true, value: Object.freeze([...parsed.value.sources]) };
  } catch (caught) {
    return classifyRpcError({ message: caught instanceof Error ? caught.message : String(caught ?? "") });
  }
}

export async function getSeriesCandidateAuthoringPreview(
  clubId: string,
  tournamentId: string,
): Promise<SeriesCandidateAuthoringRpcResult<SeriesCandidateAuthoringPreview>> {
  if (!isPostgresUuid(clubId) || !isPostgresUuid(tournamentId)) return { ok: false, error: "invalid_request", retryable: false };
  try {
    const { data, error } = await candidateAuthoringClient.rpc(SERIES_CANDIDATE_AUTHORING_RPC.preview, {
      p_club_id: clubId,
      p_tournament_id: tournamentId,
    });
    if (error) return classifyRpcError(error);
    const parsed = parseSeriesCandidateAuthoringPreview(data);
    return parsed.ok && parsed.value.clubId === clubId && parsed.value.tournamentId === tournamentId
      ? parsed
      : { ok: false, error: "malformed_response", retryable: false };
  } catch (caught) {
    return classifyRpcError({ message: caught instanceof Error ? caught.message : String(caught ?? "") });
  }
}

export async function approveSeriesCandidateFromTournament(
  request: ApproveSeriesCandidateFromTournamentRequest,
): Promise<SeriesCandidateAuthoringRpcResult<ApprovedSeriesCandidateFromTournament>> {
  if (
    !isPostgresUuid(request.clubId)
    || !isPostgresUuid(request.tournamentId)
    || !isNonNegativeSafeInteger(request.gtdVnd)
    || (request.prizeContributionPerEntryVnd !== null && !isPositiveSafeInteger(request.prizeContributionPerEntryVnd))
    || !Number.isSafeInteger(request.flights)
    || request.flights < 1
    || request.flights > 1_000
    || (request.expectedDurationMinutes !== null && (!Number.isSafeInteger(request.expectedDurationMinutes) || request.expectedDurationMinutes < 1 || request.expectedDurationMinutes > 100_000))
  ) {
    return { ok: false, error: "invalid_request", retryable: false };
  }

  try {
    const { data, error } = await candidateAuthoringClient.rpc(SERIES_CANDIDATE_AUTHORING_RPC.approveFromTournament, {
      p_club_id: request.clubId,
      p_tournament_id: request.tournamentId,
      p_gtd_vnd: request.gtdVnd,
      p_prize_contribution_per_entry_vnd: request.prizeContributionPerEntryVnd,
      p_flights: request.flights,
      p_expected_duration_minutes: request.expectedDurationMinutes,
    });
    if (error) return classifyRpcError(error);
    const approval = parseEnvelope(approvalSchema, data);
    if (!approval.ok) return approval;

    const { data: readbackData, error: readbackError } = await candidateAuthoringClient.rpc(SERIES_CANDIDATE_AUTHORING_RPC.approvedReadback, {
      p_club_id: request.clubId,
      p_option_ids: [approval.value.optionId],
    });
    if (readbackError) return classifyRpcError(readbackError);
    const readback = parseEnvelope(approvedReadbackSchema, readbackData);
    if (!readback.ok) return readback;
    const matching = readback.value.candidateOptions.filter((candidate) => candidate.optionId === approval.value.optionId);
    if (readback.value.clubId !== request.clubId || matching.length !== 1) {
      return { ok: false, error: "readback_mismatch", retryable: false };
    }
    return { ok: true, value: { approval: approval.value, candidate: matching[0] } };
  } catch (caught) {
    return classifyRpcError({ message: caught instanceof Error ? caught.message : String(caught ?? "") });
  }
}
