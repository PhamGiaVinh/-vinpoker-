import type {
  CommitVoiceHoleCardsInput,
  CommitVoiceBoardInput,
  CommitVoiceFinishInput,
  PrepareVoiceFinishInput,
  TrackerVoiceRuntimeContext,
  ValidateVoiceEventInput,
  ValidatedVoiceEventReceipt,
  VoiceBoardCommitReceipt,
  VoiceHoleCardsCommitReceipt,
  VoiceFinishCommitReceipt,
  VoiceFinishProposalReceipt,
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
      voice_request: input.canonicalRequest,
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

/** Commits one already-validated Board proposal through the atomic RPC Edge seam. */
export async function commitTrackerVoiceBoard(
  input: CommitVoiceBoardInput,
): Promise<VoiceBoardCommitReceipt> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("tournament-live-update", {
    body: {
      tournament_id: input.tournamentId,
      action: "commit_voice_board",
      tournament_table_id: input.tournamentTableId,
      hand_id: input.handId,
      voice_event_id: input.voiceEventId,
      idempotency_key: input.idempotencyKey,
      trace_id: input.traceId,
      // Diagnostic only. The Edge/RPC reconstruct from the immutable root.
      voice_request: input.canonicalRequest,
    },
  });
  if (error) throw new Error(error.message);
  const envelope = data as { data?: VoiceBoardCommitReceipt; error?: string } | null;
  if (envelope?.error) throw new Error(envelope.error);
  const receipt = envelope?.data;
  if (!receipt?.ok || !Array.isArray(receipt.community_cards)) {
    throw new Error("Voice Board không trả canonical receipt hợp lệ.");
  }
  return receipt;
}

/**
 * Confirms one private hole-card proposal. Unlike generic Voice validation,
 * this sends the raw speech only at touch-confirm and expects a redacted receipt.
 */
export async function commitTrackerVoiceHoleCards(
  input: CommitVoiceHoleCardsInput,
): Promise<VoiceHoleCardsCommitReceipt> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("tournament-live-update", {
    body: {
      tournament_id: input.tournamentId,
      action: "commit_voice_hole_cards",
      tournament_table_id: input.tournamentTableId,
      hand_id: input.handId,
      final_transcript: input.finalTranscript,
      provider_name: input.providerName,
      provider_model: input.providerModel,
      provider_event_id: input.providerEventId,
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
      trace_id: input.traceId,
      voice_request: input.canonicalRequest,
    },
  });
  if (error) throw new Error(error.message);
  const envelope = data as { data?: VoiceHoleCardsCommitReceipt; error?: string } | null;
  if (envelope?.error) throw new Error(envelope.error);
  const receipt = envelope?.data;
  if (!receipt?.ok || receipt.redacted !== true || typeof receipt.player_id !== "string") {
    throw new Error("Voice bài tẩy không trả redacted canonical receipt hợp lệ.");
  }
  return receipt;
}

/** Reads a server-recomputed settlement preview. It never writes poker state. */
export async function prepareTrackerVoiceFinish(
  input: PrepareVoiceFinishInput,
): Promise<VoiceFinishProposalReceipt> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("tournament-live-update", {
    body: {
      tournament_id: input.tournamentId,
      action: "prepare_voice_finish",
      tournament_table_id: input.tournamentTableId,
      hand_id: input.handId,
      final_transcript: input.finalTranscript,
      provider_name: input.providerName,
      provider_model: input.providerModel,
      provider_event_id: input.providerEventId,
      expected_state_version: input.expectedStateVersion,
    },
  });
  if (error) throw new Error(error.message);
  const envelope = data as { data?: VoiceFinishProposalReceipt; error?: string } | null;
  if (envelope?.error) throw new Error(envelope.error);
  const receipt = envelope?.data;
  if (!receipt?.ok || typeof receipt.settlement_digest !== "string") {
    throw new Error("Voice Finish không trả proposal settlement hợp lệ.");
  }
  return receipt;
}

/** Touch-confirmed server recomputation followed by the atomic canonical writer. */
export async function commitTrackerVoiceFinish(
  input: CommitVoiceFinishInput,
): Promise<VoiceFinishCommitReceipt> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("tournament-live-update", {
    body: {
      tournament_id: input.tournamentId,
      action: "commit_voice_finish",
      tournament_table_id: input.tournamentTableId,
      hand_id: input.handId,
      final_transcript: input.finalTranscript,
      provider_name: input.providerName,
      provider_model: input.providerModel,
      provider_event_id: input.providerEventId,
      expected_state_version: input.expectedStateVersion,
      idempotency_key: input.idempotencyKey,
      trace_id: input.traceId,
      voice_request: input.canonicalRequest,
    },
  });
  if (error) throw new Error(error.message);
  const envelope = data as { data?: VoiceFinishCommitReceipt; error?: string } | null;
  if (envelope?.error) throw new Error(envelope.error);
  const receipt = envelope?.data;
  if (!receipt?.ok || typeof receipt.hand_id !== "string") {
    throw new Error("Voice Finish không trả canonical receipt hợp lệ.");
  }
  return receipt;
}
