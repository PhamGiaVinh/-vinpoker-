export type VoiceCommandKind =
  | "fold"
  | "check"
  | "call"
  | "bet_to"
  | "raise_to"
  | "all_in"
  | "report_wrong_action"
  | "call_floor";

export type VoiceExecutionMode = "shadow" | "assist" | "auto";

export type VoiceProviderKind = "mock" | "openai_realtime" | "gemini_live";

export type VoiceProviderStatus =
  | "idle"
  | "requesting_permission"
  | "preparing_audio"
  | "connecting"
  | "connected"
  | "audio_running"
  | "listening"
  | "flushing"
  | "paused"
  | "recovering"
  | "offline"
  | "error";

export interface ParsedVoiceAmount {
  value: number | null;
  raw: string | null;
  explicitUnit: boolean;
  ambiguous: boolean;
}

export interface ParsedVoiceCommand {
  kind: VoiceCommandKind;
  transcript: string;
  normalizedTranscript: string;
  amount: ParsedVoiceAmount | null;
  spokenSeatNumber: number | null;
  riskTier: "EXACT" | "BOUNDED_REPAIR";
  repairs: readonly { rule: "seat_prefix_fit_to_seat"; from: "fit" | "feet"; to: "seat" }[];
  requiresConfirmation: boolean;
}

export interface VoiceTranscriptEvent {
  providerEventId: string;
  transcript: string;
  isFinal: boolean;
  providerConfidence?: number;
  capturedAt: string;
}

export interface VoiceProviderHandlers {
  onStatus: (status: VoiceProviderStatus, message?: string) => void;
  onTranscript: (event: VoiceTranscriptEvent) => void;
  onLevel?: (rms: number) => void;
  onInputDevice?: (device: { deviceId: string | null; label: string | null }) => void;
  onSession?: (session: { model: string; expiresAt: string }) => void;
}

export interface RealtimeTranscriptionProvider {
  readonly kind: VoiceProviderKind;
  connect(handlers: VoiceProviderHandlers): Promise<void>;
  /** Stops microphone capture but may keep a realtime session alive to flush a final transcript. */
  pause?(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface VoiceActorSnapshot {
  playerId: string;
  playerName: string;
  seatNumber: number;
  currentStack: number;
  currentBet: number;
}

export interface VoiceLegalSnapshot {
  toCall: number;
  minRaiseTo: number;
  legal: {
    fold: boolean;
    check: boolean;
    call: boolean;
    bet: boolean;
    raise: boolean;
    allIn: boolean;
  };
}

export interface VoiceProposalContext {
  handId: string | null;
  street: string;
  expectedStateVersion: string | null;
  actor: VoiceActorSnapshot | null;
  actorView: VoiceLegalSnapshot | null;
  handStarted: boolean;
  actionStepActive: boolean;
  readOnly: boolean;
  syncBlocked: boolean;
  correctionPending: boolean;
}

export type VoiceProposalFailureCode =
  | "command_not_supported"
  | "amount_missing"
  | "amount_ambiguous"
  | "no_active_hand"
  | "not_action_step"
  | "actor_missing"
  | "spoken_actor_mismatch"
  | "read_only"
  | "sync_blocked"
  | "correction_pending"
  | "illegal_action"
  | "amount_out_of_range"
  | "raise_too_small";

export interface VoiceActionProposal {
  ok: true;
  command: ParsedVoiceCommand;
  actor: VoiceActorSnapshot;
  canonicalAction: "fold" | "check" | "call" | "bet" | "raise" | "all_in";
  betToTotal?: number;
  expectedStateVersion: string | null;
}

export interface VoiceControlProposal {
  ok: true;
  command: ParsedVoiceCommand;
  controlAction: "report_wrong_action" | "call_floor";
  expectedStateVersion: string | null;
}

export interface VoiceRejectedProposal {
  ok: false;
  command: ParsedVoiceCommand | null;
  code: VoiceProposalFailureCode;
  message: string;
}

export type VoiceProposal = VoiceActionProposal | VoiceControlProposal | VoiceRejectedProposal;

export interface VoiceActionMetadata {
  source: "voice";
  tournamentTableId: string;
  voiceEventId: string;
  idempotencyKey: string;
  traceId: string;
  expectedStateVersion: string;
}

export interface TrackerVoiceRuntimeContext {
  ok: boolean;
  error?: string;
  can_mint_session: boolean;
  read_only: boolean;
  tournament_table_id?: string;
  physical_table_id?: string;
  correction_pending: boolean;
  config: {
    enabled: boolean;
    configured_mode: VoiceExecutionMode;
    provider_model: string;
    spoken_amount_unit: number;
    amount_unit_confirmed: boolean;
    provider_confidence_threshold: number | null;
    server_auto_allowed: boolean;
    correction_state: "ready" | "correction_pending";
  };
  active_hand: null | {
    hand_id: string;
    hand_number: number;
    status: string;
    state_version: string;
  };
}

export interface ValidatedVoiceEventReceipt {
  ok: true;
  voice_event_id: string;
  idempotency_key: string;
  trace_id: string;
  state_version: string;
  execution_mode: VoiceExecutionMode;
  execution_result: "validated" | "alert_opened";
  correction_pending: boolean;
  alert_id: string | null;
  duplicate?: boolean;
}

export interface ValidateVoiceEventInput {
  tournamentId: string;
  tournamentTableId: string;
  handId: string;
  finalTranscript: string;
  providerName: VoiceProviderKind;
  providerModel: string;
  providerEventId: string;
  providerConfidence?: number;
  executionMode: VoiceExecutionMode;
  expectedStateVersion: string;
  idempotencyKey: string;
  traceId: string;
}
