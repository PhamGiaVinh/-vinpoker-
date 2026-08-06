import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  parseDecisionEventStateResponse,
  type DecisionEventStateBackendError,
  type DecisionEventStateResponse,
} from "./decisionPacketRuntimeTypes";

// D2B is intentionally isolated from generated Supabase types until a separately trusted type-sync can land.
// Keep this cast private to this file: callers receive only validated versioned responses.
const d2bClient = supabase as unknown as SupabaseClient;

const D2B_RPC = {
  promoteNativeActual: "series_promote_native_event_actual_v1",
  reconcileActual: "series_reconcile_event_actual_v1",
  getEventState: "series_get_decision_event_state_v1",
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

export async function getDecisionEventState(eventId: string): Promise<DecisionPacketRpcResult<DecisionEventStateResponse>> {
  const { data, error } = await d2bClient.rpc(D2B_RPC.getEventState, { p_event_id: eventId });
  if (error) return { ok: false, error: classifyRpcError(error) };
  return parseDecisionEventStateResponse(data);
}
