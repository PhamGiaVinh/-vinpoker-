import type {
  TrackerVoiceRuntimeContext,
  ValidateVoiceEventInput,
  ValidatedVoiceEventReceipt,
} from "./types";

export async function loadTrackerVoiceRuntimeContext(
  tournamentId: string,
  tournamentTableId: string,
): Promise<TrackerVoiceRuntimeContext> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.rpc("get_tracker_voice_runtime_context" as never, {
    p_tournament_id: tournamentId,
    p_tournament_table_id: tournamentTableId,
  } as never);
  if (error) throw new Error(error.message);
  const result = data as unknown as TrackerVoiceRuntimeContext | null;
  if (!result?.ok) throw new Error(result?.error ?? "Không tải được quyền Voice cho bàn này.");
  return result;
}

export async function validateTrackerVoiceEvent(
  input: ValidateVoiceEventInput,
): Promise<ValidatedVoiceEventReceipt> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("tournament-live-update", {
    body: {
      tournament_id: input.tournamentId,
      action: "validate_voice_event",
      tournament_table_id: input.tournamentTableId,
      hand_id: input.handId,
      final_transcript: input.finalTranscript,
      provider_name: input.providerName,
      provider_model: input.providerModel,
      provider_event_id: input.providerEventId,
      provider_confidence: input.providerConfidence ?? null,
      execution_mode: input.executionMode,
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
      trace_id: input.traceId,
    },
  });
  if (error) {
    try {
      const context = (error as { context?: Response }).context;
      const payload = context ? await context.clone().json() as { error?: string; code?: string } : null;
      throw new Error(payload?.error ?? payload?.code ?? error.message);
    } catch (caught) {
      if (caught instanceof Error && caught.message !== error.message) throw caught;
      throw new Error(error.message);
    }
  }
  const envelope = data as { data?: unknown; error?: string } | null;
  if (envelope?.error) throw new Error(envelope.error);
  const receipt = envelope?.data as ValidatedVoiceEventReceipt | null;
  if (!receipt?.ok || typeof receipt.voice_event_id !== "string") {
    throw new Error("Voice validation không trả receipt hợp lệ.");
  }
  return receipt;
}
