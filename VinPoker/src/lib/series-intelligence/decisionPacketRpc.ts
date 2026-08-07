import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  parseDecisionEventStateResponse,
  type DecisionEventStateBackendError,
  type DecisionEventStateResponse,
} from "./decisionPacketRuntimeTypes";
import type {
  DecisionPacketCreateRequestInput,
  EventActualCreateRequestInput,
} from "./decisionPacketV1";
import { buildDecisionPacketCreateRequestIdentity } from "./decisionPacketV1";

// D2B is intentionally isolated from generated Supabase types until a separately trusted type-sync can land.
// Keep this cast private to this file: callers receive only validated versioned responses.
const d2bClient = supabase as unknown as SupabaseClient;

const D2B_RPC = {
  promoteNativeActual: "series_promote_native_event_actual_v1",
  reconcileActual: "series_reconcile_event_actual_v1",
  getEventState: "series_get_decision_event_state_v1",
} as const;

const D2A_RPC = {
  createPacket: "series_create_decision_packet_v1",
  freezePacket: "series_freeze_decision_packet_v1",
  recordActual: "series_record_event_actual_v1",
} as const;

export type DecisionPacketRpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DecisionEventStateBackendError };

export interface PromoteNativeEventActualRequest {
  readonly eventId: string;
  readonly idempotencyKey: string;
}

export interface ReconcileEventActualRequest {
  readonly autoRevisionId: string;
  readonly manualRevisionId: string;
  readonly resolution: Record<string, unknown>;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface FreezeDecisionPacketRequest {
  readonly packetId: string;
  readonly expectedDraftVersion: number;
}

export type DecisionPacketMutationSummary = Readonly<Record<string, unknown>>;

function classifyRpcError(error: { code?: string; message?: string } | null): DecisionEventStateBackendError {
  if (!error) return "malformed_response";
  if (["42P01", "PGRST202", "PGRST205", "PGRST203", "404"].includes(error.code ?? "") || /does not exist|could not find|schema cache/i.test(error.message ?? "")) return "backend_unavailable";
  return "rpc_error";
}

function parseMutationResponse(value: unknown): DecisionPacketRpcResult<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "malformed_response" };
  const record = value as Record<string, unknown>;
  if (record.version !== "series-decision-event-state-v1" || typeof record.state !== "string") return { ok: false, error: "malformed_response" };
  return { ok: true, value: record };
}

function parseD2AMutationResponse(value: unknown): DecisionPacketRpcResult<DecisionPacketMutationSummary> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "malformed_response" };
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.schema_version !== "string") {
    return { ok: false, error: "malformed_response" };
  }
  return { ok: true, value: record };
}

export async function promoteNativeEventActual(request: PromoteNativeEventActualRequest): Promise<DecisionPacketRpcResult<Record<string, unknown>>> {
  const { data, error } = await d2bClient.rpc(D2B_RPC.promoteNativeActual, {
    p_event_id: request.eventId,
    p_idempotency_key: request.idempotencyKey,
  });
  return error ? { ok: false, error: classifyRpcError(error) } : parseMutationResponse(data);
}

export async function reconcileEventActual(request: ReconcileEventActualRequest): Promise<DecisionPacketRpcResult<Record<string, unknown>>> {
  const { data, error } = await d2bClient.rpc(D2B_RPC.reconcileActual, {
    p_auto_revision_id: request.autoRevisionId,
    p_manual_revision_id: request.manualRevisionId,
    p_resolution: request.resolution,
    p_reason: request.reason,
    p_idempotency_key: request.idempotencyKey,
  });
  return error ? { ok: false, error: classifyRpcError(error) } : parseMutationResponse(data);
}

export async function createDecisionPacket(
  request: DecisionPacketCreateRequestInput,
): Promise<DecisionPacketRpcResult<DecisionPacketMutationSummary>> {
  try {
    await buildDecisionPacketCreateRequestIdentity(request);
  } catch {
    return { ok: false, error: "malformed_response" };
  }

  const { data, error } = await d2bClient.rpc(D2A_RPC.createPacket, {
    p_event_id: request.eventId,
    p_decision_horizon: request.horizon,
    p_target_metric: request.targetMetric,
    p_as_of_ts: request.asOfTs,
    p_source_cutoff: request.sourceCutoff,
    p_target_event_ts: request.targetEventTs,
    p_forecast_snapshot_id: request.forecastSnapshotId,
    p_forecast_state: request.forecastState,
    p_manual_expectation: request.manualExpectation,
    p_public_evidence_manifest: request.publicEvidence,
    p_registration_slice_manifest: request.registrationSlice,
    p_registration_observation_count: request.registrationSlice?.observationCount ?? null,
    p_campaign_slice_manifest: request.campaignSlice,
    p_campaign_observation_count: request.campaignSlice?.observationCount ?? null,
    p_known_information: request.knownInformation,
    p_recommended_action: request.recommendedAction?.text ?? null,
    p_recommendation_source_kind: request.recommendedAction?.sourceKind ?? null,
    p_recommendation_source_ref: request.recommendedAction?.sourceReferenceId ?? null,
    p_owner_decision: request.ownerDecision,
    p_public_action: request.publicAction,
    p_decision_reason: request.decisionReason,
    p_alternatives: request.alternatives,
    p_assumptions: request.assumptions,
    p_uncertainty_notes: request.uncertaintyNotes,
    p_supersedes_packet_id: request.supersedesPacketId,
    p_correction_reason: request.correctionReason,
    p_idempotency_key: request.idempotencyKey,
  });
  return error ? { ok: false, error: classifyRpcError(error) } : parseD2AMutationResponse(data);
}

export async function freezeDecisionPacket(
  request: FreezeDecisionPacketRequest,
): Promise<DecisionPacketRpcResult<DecisionPacketMutationSummary>> {
  if (!request.packetId || !Number.isSafeInteger(request.expectedDraftVersion) || request.expectedDraftVersion < 1) {
    return { ok: false, error: "malformed_response" };
  }
  const { data, error } = await d2bClient.rpc(D2A_RPC.freezePacket, {
    p_packet_id: request.packetId,
    p_expected_draft_version: request.expectedDraftVersion,
  });
  return error ? { ok: false, error: classifyRpcError(error) } : parseD2AMutationResponse(data);
}

export async function recordEventActual(
  request: EventActualCreateRequestInput,
): Promise<DecisionPacketRpcResult<DecisionPacketMutationSummary>> {
  const { data, error } = await d2bClient.rpc(D2A_RPC.recordActual, {
    p_event_id: request.eventId,
    p_outcome_scope: request.scope,
    p_finality: request.finality,
    p_source_timestamp_state: request.sourceTimestampState,
    p_source_timestamp: request.sourceTimestamp,
    p_entries_availability: request.metrics.entries.availability,
    p_entries_value: request.metrics.entries.value,
    p_unique_players_availability: request.metrics.uniquePlayers.availability,
    p_unique_players_value: request.metrics.uniquePlayers.value,
    p_total_bullets_availability: request.metrics.totalBullets.availability,
    p_total_bullets_value: request.metrics.totalBullets.value,
    p_reentries_availability: request.metrics.reentries.availability,
    p_reentries_value: request.metrics.reentries.value,
    p_registration_records_availability: request.metrics.registrationRecords.availability,
    p_registration_records_value: request.metrics.registrationRecords.value,
    p_paid_places_availability: request.metrics.paidPlaces.availability,
    p_paid_places_value: request.metrics.paidPlaces.value,
    p_prize_pool_availability: request.metrics.prizePool.availability,
    p_prize_pool_amount_minor: request.metrics.prizePool.amountMinor,
    p_prize_pool_currency: request.metrics.prizePool.currency,
    p_prize_pool_scale: request.metrics.prizePool.scale,
    p_overlay_availability: request.metrics.overlay.availability,
    p_overlay_amount_minor: request.metrics.overlay.amountMinor,
    p_overlay_currency: request.metrics.overlay.currency,
    p_overlay_scale: request.metrics.overlay.scale,
    p_supersedes_revision_id: request.supersedesRevisionId,
    p_idempotency_key: request.idempotencyKey,
    p_correction_reason: request.correctionReason,
  });
  return error ? { ok: false, error: classifyRpcError(error) } : parseD2AMutationResponse(data);
}

export async function getDecisionEventState(eventId: string): Promise<DecisionPacketRpcResult<DecisionEventStateResponse>> {
  const { data, error } = await d2bClient.rpc(D2B_RPC.getEventState, { p_event_id: eventId });
  if (error) return { ok: false, error: classifyRpcError(error) };
  return parseDecisionEventStateResponse(data);
}
