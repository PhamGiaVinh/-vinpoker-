export const TRACKER_UNIFIED_OPS_CONTRACT_VERSION = "tracker-unified-ops-v2" as const;
export const TRACKER_CONTEXT_HASH_VERSION = "tracker-context-v1" as const;

export const TRACKER_STACK_CORRECTION_REASON_CODES = [
  "physical_recount",
  "operator_entry_correction",
  "post_table_move_reconciliation",
] as const;

export const TRACKER_IDEMPOTENT_MUTATION_OPERATIONS = [
  "start_hand",
  "correct_stack",
  "ack_stack_correction",
  "void_hand",
] as const;

export const TRACKER_READINESS_BLOCKER_CODES = [
  "table_not_found",
  "table_not_active",
  "table_tournament_mismatch",
  "table_identity_ambiguous",
  "tracker_mode_required",
  "seat_entry_missing",
  "seat_entry_mismatch",
  "duplicate_active_player",
  "duplicate_seat",
  "not_enough_players",
  "stack_non_positive",
  "stack_projection_mismatch",
  "current_level_missing",
  "current_level_invalid",
  "tournament_break_active",
  "active_hand_exists",
  "lock_owned_by_other",
  "stale_table_context",
] as const;

export const TRACKER_READINESS_WARNING_CODES = [
  "clock_paused",
  "chip_set_not_bound",
  "stack_template_missing",
  "issuance_missing",
  "denomination_inventory_not_conserved",
  "pending_stack_corrections",
] as const;

export type TrackerStackCorrectionReasonCode =
  (typeof TRACKER_STACK_CORRECTION_REASON_CODES)[number];
export type TrackerIdempotentMutationOperation =
  (typeof TRACKER_IDEMPOTENT_MUTATION_OPERATIONS)[number];
export type TrackerReadinessBlockerCode =
  (typeof TRACKER_READINESS_BLOCKER_CODES)[number];
export type TrackerReadinessWarningCode =
  (typeof TRACKER_READINESS_WARNING_CODES)[number];
export type TrackerReadinessCode =
  | TrackerReadinessBlockerCode
  | TrackerReadinessWarningCode;

export type TrackerOpsRole =
  | "tracker"
  | "floor"
  | "chipmaster"
  | "owner"
  | "super_admin";

export type TrackerOpsCapability =
  | "read_context"
  | "view_chipmaster_projection"
  | "start_hand"
  | "record_hand"
  | "void_hand"
  | "set_control_mode"
  | "manage_roster"
  | "correct_stack"
  | "edit_display_identity"
  | "ack_stack_correction";

export const TRACKER_OPS_ROLE_CAPABILITIES = {
  tracker: [
    "read_context",
    "view_chipmaster_projection",
    "start_hand",
    "record_hand",
    "void_hand",
    "edit_display_identity",
  ],
  floor: [
    "read_context",
    "view_chipmaster_projection",
    "set_control_mode",
    "manage_roster",
    "correct_stack",
    "edit_display_identity",
  ],
  chipmaster: [
    "view_chipmaster_projection",
    "ack_stack_correction",
  ],
  owner: [
    "read_context",
    "view_chipmaster_projection",
    "start_hand",
    "record_hand",
    "void_hand",
    "set_control_mode",
    "manage_roster",
    "correct_stack",
    "edit_display_identity",
    "ack_stack_correction",
  ],
  super_admin: [
    "read_context",
    "view_chipmaster_projection",
    "start_hand",
    "record_hand",
    "void_hand",
    "set_control_mode",
    "manage_roster",
    "correct_stack",
    "edit_display_identity",
    "ack_stack_correction",
  ],
} as const satisfies Record<TrackerOpsRole, readonly TrackerOpsCapability[]>;

export type TrackerReadinessOwner = "floor" | "tracker" | "chipmaster";
export type TrackerReadinessSeverity = "blocker" | "warning";

export type TrackerReadinessRemediation =
  | "open_floor_table"
  | "open_floor_seat"
  | "open_floor_mode"
  | "open_floor_stack"
  | "open_floor_level"
  | "resume_hand"
  | "request_takeover"
  | "refresh_context"
  | "open_chipmaster"
  | "none";

export type TrackerReadinessTargetV2 = {
  tournament_table_id?: string;
  physical_table_id?: string;
  seat_id?: string;
  seat_number?: number;
  entry_id?: string;
  hand_id?: string;
};

export type TrackerReadinessItemV2 = {
  code: TrackerReadinessCode;
  severity: TrackerReadinessSeverity;
  owner: TrackerReadinessOwner;
  message_key: string;
  target: TrackerReadinessTargetV2 | null;
  remediation: TrackerReadinessRemediation;
};

export type TrackerReadinessV2 = {
  state: "ready" | "blocked";
  blockers: readonly TrackerReadinessItemV2[];
  warnings: readonly TrackerReadinessItemV2[];
};

export type TrackerTableControlModeV2 = "manual" | "tracker";
export type TrackerTableStatusV2 = "active" | "paused" | "closed";
export type TrackerLauncherGroupV2 = "ready" | "active_hand" | "needs_floor";
export type TrackerHandLockStateV2 = "mine" | "other" | "stale";
export type TrackerActiveHandActionV2 =
  | "resume"
  | "request_takeover"
  | "explicit_void";

export type TrackerRosterSeatV2 = {
  seat_id: string;
  entry_id: string;
  player_id: string;
  entry_number: number;
  seat_number: number;
  seat_stack: number;
  tracker_stack: number;
  entry_stack: number;
  display_name: string;
  avatar_url: string | null;
};

export type TrackerActiveHandV2 = {
  hand_id: string;
  hand_number: number;
  status: "in_progress";
  started_at: string;
  locked_by_user_id: string | null;
  locked_at: string | null;
  lock_version: number | string;
  lock_state: TrackerHandLockStateV2;
  allowed_action: TrackerActiveHandActionV2;
};

export type TrackerLevelV2 = {
  id: string;
  number: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  is_break: boolean;
  clock_paused: boolean;
};

export type TrackerChipMasterProjectionV2 = {
  chip_set_bound: boolean;
  template_count: number;
  issued_template_count: number;
  denomination_inventory_conserved: boolean;
  pending_correction_count: number;
};

export type TrackerTableContextV2 = {
  ok: true;
  contract_version: typeof TRACKER_UNIFIED_OPS_CONTRACT_VERSION;
  tournament_id: string;
  tournament_name: string;
  tournament_table_id: string;
  physical_table_id: string;
  table_name: string;
  table_number: number;
  table_status: TrackerTableStatusV2;
  control_mode: TrackerTableControlModeV2;
  control_revision: number;
  context_version: string;
  next_hand_number: number;
  roster: readonly TrackerRosterSeatV2[];
  active_hand: TrackerActiveHandV2 | null;
  level: TrackerLevelV2 | null;
  readiness: TrackerReadinessV2;
  chipmaster: TrackerChipMasterProjectionV2;
  capabilities: readonly TrackerOpsCapability[];
};

export type TrackerTableSummaryV2 = {
  tournament_id: string;
  tournament_table_id: string;
  physical_table_id: string;
  table_name: string;
  table_number: number;
  table_status: TrackerTableStatusV2;
  control_mode: TrackerTableControlModeV2;
  context_version: string;
  player_count: number;
  next_hand_number: number;
  active_hand: TrackerActiveHandV2 | null;
  launcher_group: TrackerLauncherGroupV2;
  readiness: TrackerReadinessV2;
};

export type ListTrackerTablesResponseV2 =
  | {
      ok: true;
      contract_version: typeof TRACKER_UNIFIED_OPS_CONTRACT_VERSION;
      tournament_id: string;
      tournament_name: string;
      tables: readonly TrackerTableSummaryV2[];
    }
  | TrackerOpsFailureV2;

export const TRACKER_OPS_FAILURE_CODES = [
  "unauthorized",
  "actor_not_allowed",
  "tournament_not_found",
  "tournament_not_open",
  "table_not_found",
  "table_tournament_mismatch",
  "ambiguous_table_identity",
  "stale_table_context",
  "active_hand_exists",
  "idempotency_mismatch",
  "invalid_idempotency_key",
  "invalid_button_seat",
  "invalid_stack",
  "invalid_reason_code",
  "seat_not_found",
  "seat_not_active",
  "entry_not_seated",
  "stack_projection_mismatch",
  "stack_changed",
  "hand_not_found",
  "hand_not_in_progress",
  "lock_owned_by_other",
] as const;

export type TrackerOpsFailureCodeV2 =
  (typeof TRACKER_OPS_FAILURE_CODES)[number];

export type TrackerOpsFailureV2 = {
  ok: false;
  error: TrackerOpsFailureCodeV2;
  message_key: string;
  context_version?: string;
  hand_id?: string;
  lock_state?: TrackerHandLockStateV2;
  allowed_action?: TrackerActiveHandActionV2;
};

export type TrackerReadinessBlockedFailureV2 = {
  ok: false;
  error: "readiness_blocked";
  message_key: string;
  context_version: string;
  readiness: TrackerReadinessV2;
};

export type TrackerMutationFailureV2 =
  | TrackerOpsFailureV2
  | TrackerReadinessBlockedFailureV2;

export type TrackerIdempotencyScopeV2 = {
  operation: TrackerIdempotentMutationOperation;
  actor_user_id: string;
  tournament_id: string;
  idempotency_key: string;
};

export type TrackerOpsReceiptV2 = {
  receipt_id: string;
  operation: TrackerIdempotentMutationOperation;
  actor_user_id: string;
  tournament_id: string;
  idempotency_key: string;
  request_hash: string;
  replayed: boolean;
};

export type StartTrackerHandIntentV2 = {
  tournament_id: string;
  tournament_table_id: string;
  button_seat: number;
  expected_context_version: string;
  idempotency_key: string;
};

export type StartTrackerHandResponseV2 =
  | {
      ok: true;
      outcome: "started";
      hand_id: string;
      hand_number: number;
      hand_time: string;
      tournament_table_id: string;
      physical_table_id: string;
      starting_context_version: string;
      next_context_version: string;
      level: TrackerLevelV2;
      receipt: TrackerOpsReceiptV2;
    }
  | TrackerMutationFailureV2;

export type CorrectTrackerStackIntentV2 = {
  tournament_id: string;
  tournament_table_id: string;
  seat_id: string;
  expected_old_stack: number;
  new_stack: number;
  reason_code: TrackerStackCorrectionReasonCode;
  note: string;
  expected_context_version: string;
  idempotency_key: string;
};

export type CorrectTrackerStackResponseV2 =
  | {
      ok: true;
      outcome: "corrected" | "unchanged";
      correction_id: string | null;
      tournament_table_id: string;
      seat_id: string;
      old_stack: number;
      new_stack: number;
      next_context_version: string;
      receipt: TrackerOpsReceiptV2;
    }
  | TrackerMutationFailureV2;

export type AckTrackerStackCorrectionIntentV2 = {
  correction_id: string;
  idempotency_key: string;
};

export type AckTrackerStackCorrectionResponseV2 =
  | {
      ok: true;
      outcome: "acknowledged";
      acknowledgement_id: string;
      correction_id: string;
      acknowledged_at: string;
      receipt: TrackerOpsReceiptV2;
    }
  | TrackerOpsFailureV2;

export type VoidTrackerHandIntentV2 = {
  hand_id: string;
  expected_context_version: string;
  reason_code: string;
  note: string;
  idempotency_key: string;
};

export type VoidTrackerHandResponseV2 =
  | {
      ok: true;
      outcome: "voided";
      hand_id: string;
      next_context_version: string;
      receipt: TrackerOpsReceiptV2;
    }
  | TrackerMutationFailureV2;

export type TrackerContextHashRosterSeatV1 = {
  seat_id: string;
  entry_id: string;
  player_id: string;
  entry_number: number;
  seat_number: number;
  seat_stack: number;
  tracker_stack: number;
  entry_stack: number;
};

export type TrackerContextHashInputV1 = {
  context_hash_version: typeof TRACKER_CONTEXT_HASH_VERSION;
  tournament: {
    id: string;
    status: string;
  };
  table: {
    tournament_table_id: string;
    physical_table_id: string;
    status: TrackerTableStatusV2;
    control_mode: TrackerTableControlModeV2;
    control_revision: number;
  };
  roster: readonly TrackerContextHashRosterSeatV1[];
  active_hand: {
    hand_id: string;
    hand_number: number;
    status: "in_progress";
    locked_by_user_id: string | null;
    lock_version: number | string;
  } | null;
  next_hand_number: number;
  level: TrackerLevelV2 | null;
};
