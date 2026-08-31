import type { TrackerWorkflowState, WorkflowStreet } from "@/components/cashier/tournament-live/handinput/trackerWorkflow";
import type { VoiceCanonicalRequest } from "./canonicalRequest";

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
  entryNumber: number;
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
  street: WorkflowStreet;
  workflowState: TrackerWorkflowState;
  actionOrder: number;
  expectedStateVersion: string | null;
  actor: VoiceActorSnapshot | null;
  actorView: VoiceLegalSnapshot | null;
  handStarted: boolean;
  actionStepActive: boolean;
  readOnly: boolean;
  syncBlocked: boolean;
  correctionPending: boolean;
  persistedBoardCards?: readonly string[];
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
  | "raise_too_small"
  | "wrong_workflow"
  | "intent_ambiguous"
  | "board_already_persisted"
  | "duplicate_card"
  | "hole_cards_seat_not_found"
  | "hole_cards_local_draft_exists"
  | "showdown_hole_cards_deferred_muck_authority"
  | "finish_requires_manual_showdown"
  | "finish_proposal_stale";

export interface ParsedVoiceBoardCommand {
  street: "flop" | "turn" | "river";
  rawTranscript: string;
  normalizedTranscript: string;
  newCards: readonly string[];
}

export interface ParsedVoiceHoleCardsCommand {
  kind: "hole_cards";
  rawTranscript: string;
  normalizedTranscript: string;
  seatNumber: number;
  cards: readonly [string, string];
}

export interface ParsedVoiceFinishCommand {
  kind: "finish_hand";
  rawTranscript: string;
  normalizedTranscript: string;
}

export interface VoiceBoardProposal {
  ok: true;
  intentDomain: "board";
  command: ParsedVoiceBoardCommand;
  expectedStateVersion: string | null;
  expectedWorkflowState: TrackerWorkflowState;
  expectedStreet: "flop" | "turn" | "river";
  expectedExistingBoardCount: 0 | 3 | 4;
  persistedBoardCards: readonly string[];
  cumulativeCards: readonly string[];
}

export interface VoiceActionProposal {
  ok: true;
  command: ParsedVoiceCommand;
  actor: VoiceActorSnapshot;
  canonicalAction: "fold" | "check" | "call" | "bet" | "raise" | "all_in";
  betToTotal?: number;
  expectedStateVersion: string | null;
  expectedWorkflowState: TrackerWorkflowState;
  expectedStreet: WorkflowStreet;
  expectedActionOrder: number;
  expectedActionAmount: number;
}

export interface VoiceHoleCardsPlayer {
  playerId: string;
  playerName: string;
  seatNumber: number;
  entryNumber: number;
}

export interface VoiceHoleCardsProposalContext {
  handId: string | null;
  workflowState: TrackerWorkflowState;
  expectedStateVersion: string | null;
  handStarted: boolean;
  readOnly: boolean;
  syncBlocked: boolean;
  correctionPending: boolean;
  players: readonly VoiceHoleCardsPlayer[];
  localCardsByPlayerId: Readonly<Record<string, readonly (string | null)[]>>;
}

/** Private browser-memory proposal. Do not place this in telemetry snapshots. */
export interface VoiceHoleCardsProposal {
  ok: true;
  intentDomain: "hole_cards";
  command: ParsedVoiceHoleCardsCommand;
  player: VoiceHoleCardsPlayer;
  expectedStateVersion: string | null;
  expectedWorkflowState: "runout_reveal";
  expectedStreet: "showdown";
}

export interface VoiceFinishProposalContext {
  handId: string | null;
  workflowState: TrackerWorkflowState;
  expectedStateVersion: string | null;
  handStarted: boolean;
  readOnly: boolean;
  syncBlocked: boolean;
  correctionPending: boolean;
}

export interface VoiceFinishProposal {
  ok: true;
  intentDomain: "finish_hand";
  command: ParsedVoiceFinishCommand;
  expectedStateVersion: string | null;
  expectedWorkflowState: "submit_ready";
  expectedStreet: "showdown";
}

export interface VoiceControlProposal {
  ok: true;
  command: ParsedVoiceCommand;
  controlAction: "report_wrong_action" | "call_floor";
  expectedStateVersion: string | null;
}

export interface VoiceRejectedProposal {
  ok: false;
  command: ParsedVoiceCommand | ParsedVoiceBoardCommand | ParsedVoiceHoleCardsCommand | null;
  code: VoiceProposalFailureCode;
  message: string;
}

export type VoiceProposal = VoiceActionProposal | VoiceControlProposal | VoiceBoardProposal | VoiceRejectedProposal;

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
  /** Required for poker action proposals; Floor alert controls retain their existing path. */
  canonicalRequest?: VoiceCanonicalRequest;
}

export interface CommitVoiceBoardInput {
  tournamentId: string;
  tournamentTableId: string;
  handId: string;
  voiceEventId: string;
  idempotencyKey: string;
  traceId: string;
  canonicalRequest: VoiceCanonicalRequest;
}

export interface VoiceBoardCommitReceipt {
  ok: true;
  voice_event_id: string;
  canonical_receipt_event_id: string;
  idempotency_key: string;
  trace_id: string;
  street: "flop" | "turn" | "river";
  previous_board: string[];
  community_cards: string[];
  state_version_before: string;
  state_version_after: string;
  duplicate?: boolean;
}

/** Raw hole-card speech is sent only when the Dealer touches confirm. */
export interface CommitVoiceHoleCardsInput {
  tournamentId: string;
  tournamentTableId: string;
  handId: string;
  finalTranscript: string;
  providerName: VoiceProviderKind;
  providerModel: string;
  providerEventId: string;
  expectedStateVersion: string;
  idempotencyKey: string;
  traceId: string;
  canonicalRequest: VoiceCanonicalRequest;
}

export interface PrepareVoiceFinishInput {
  tournamentId: string;
  tournamentTableId: string;
  handId: string;
  finalTranscript: string;
  providerName: VoiceProviderKind;
  providerModel: string;
  providerEventId: string;
  expectedStateVersion: string;
}

export interface VoiceFinishSummary {
  winners: Array<{ player_id: string; seat_number: number; player_name: string | null; amount: number }>;
  pots: Array<{ kind: "main" | "side"; amount: number; winner_ids: string[] }>;
  ending_stacks: Array<{ player_id: string; seat_number: number; amount: number }>;
  conservation_total: number;
}

export interface VoiceFinishProposalReceipt {
  ok: true;
  settlement_origin: "engine_fold_win" | "engine_showdown";
  settlement_digest: string;
  state_version: string;
  summary: VoiceFinishSummary;
}

export interface CommitVoiceFinishInput extends PrepareVoiceFinishInput {
  idempotencyKey: string;
  traceId: string;
  canonicalRequest: VoiceCanonicalRequest;
}

export interface VoiceFinishCommitReceipt {
  ok: true;
  voice_event_id: string;
  canonical_receipt_event_id: string;
  idempotency_key: string;
  trace_id: string;
  settlement_origin: "engine_fold_win" | "engine_showdown";
  settlement_digest: string;
  state_version_before: string;
  state_version_after: string;
  hand_id: string;
  duplicate?: boolean;
}

/** The receipt intentionally excludes sensitive card codes and raw speech. */
export interface VoiceHoleCardsCommitReceipt {
  ok: true;
  voice_event_id: string;
  canonical_receipt_event_id: string;
  idempotency_key: string;
  trace_id: string;
  seat_number: number;
  player_id: string;
  entry_number: number;
  redacted: true;
  state_version_before: string;
  state_version_after: string;
  duplicate?: boolean;
}
