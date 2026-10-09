import { classifyPostgrestError } from "../_shared/postgrestError.ts";

/** A failed authority read must never become permission to run automatic Swing. */
export async function fetchAutoSwingSettings(admin: {
  from(name: string): { select(columns: string): PromiseLike<{
    data: Array<{ club_id: string; auto_swing_enabled: unknown }> | null;
    error: unknown;
  }> };
}): Promise<Map<string, boolean>> {
  const { data, error } = await admin.from("club_settings")
    .select("club_id, auto_swing_enabled");
  if (error || !Array.isArray(data)) throw new Error("auto_swing_state_unverified");
  return new Map(data.map(row => [row.club_id, row.auto_swing_enabled === true]));
}

export type ProcessSwingDispatchState =
  | "completed"
  | "partial"
  | "locked"
  | "dependency_unavailable"
  | "business_failed";

export type LockOwnershipFailureReason = "lease_reclaimed" | "lease_check_failed";

export class LockOwnershipLost extends Error {
  constructor(
    readonly clubId: string,
    readonly reason: LockOwnershipFailureReason,
  ) {
    super(`lock ownership ${reason} for club ${clubId}`);
    this.name = "LockOwnershipLost";
  }
}

export async function ensureLockOwnership(
  admin: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown | null }> },
  clubId: string,
  lockToken: string | null,
  leaseSeconds: number,
): Promise<void> {
  if (!lockToken) return;
  try {
    const { data, error } = await admin.rpc("extend_club_lock_lease", {
      p_club_id: clubId,
      p_lock_token: lockToken,
      p_timeout_seconds: leaseSeconds,
    });
    if (error) {
      throw new LockOwnershipLost(clubId, "lease_check_failed");
    }
    if (data !== true) {
      throw new LockOwnershipLost(clubId, "lease_reclaimed");
    }
  } catch (error) {
    if (error instanceof LockOwnershipLost) throw error;
    throw new LockOwnershipLost(clubId, "lease_check_failed");
  }
}

export interface DispatchSafetyOutcome {
  dispatchState: ProcessSwingDispatchState;
  dispatchErrorCode: string;
  diagnostic: {
    stage: string;
    code: string;
  };
}

export interface DispatchOutcomeState {
  state: ProcessSwingDispatchState;
  errorCode: string | null;
}

const DISPATCH_STATE_PRIORITY: Record<ProcessSwingDispatchState, number> = {
  completed: 0,
  locked: 1,
  partial: 2,
  business_failed: 3,
  dependency_unavailable: 4,
};

export function mergeDispatchOutcome(
  current: DispatchOutcomeState,
  next: DispatchOutcomeState,
): DispatchOutcomeState {
  if (DISPATCH_STATE_PRIORITY[next.state] >= DISPATCH_STATE_PRIORITY[current.state]) {
    return next;
  }
  // A reclaimed lease can follow an already-degraded fill. Preserve the stronger
  // partial state while making the lost ownership visible in the primary code.
  if (current.state === "partial" && next.errorCode === "club_lock_ownership_lost") {
    return { state: current.state, errorCode: next.errorCode };
  }
  return current;
}

export function assessLockOwnershipLoss(
  failure: LockOwnershipLost,
): DispatchSafetyOutcome {
  const reclaimed = failure.reason === "lease_reclaimed";
  return {
    dispatchState: reclaimed ? "locked" : "business_failed",
    dispatchErrorCode: reclaimed
      ? "club_lock_ownership_lost"
      : "club_lock_ownership_check_failed",
    diagnostic: {
      stage: "club_lock_ownership",
      code: reclaimed ? "LEASE_RECLAIMED" : "LEASE_CHECK_FAILED",
    },
  };
}

export function assessCoreQueryFailure(
  stage: string,
  error: unknown,
): DispatchSafetyOutcome {
  const failure = classifyPostgrestError(error);
  return {
    dispatchState: failure.status === "dependency_unavailable"
      ? "dependency_unavailable"
      : "partial",
    dispatchErrorCode: `${stage}_${failure.status}`,
    diagnostic: {
      stage,
      code: failure.sanitizedCode,
    },
  };
}

const SWING_SESSION_FAILURE_CODES = new Map<string, string>([
  ["TABLE_SESSION_BINDING_REQUIRED", "swing_table_session_binding_required"],
  ["TABLE_SESSION_AMBIGUOUS", "swing_table_session_ambiguous"],
  ["TABLE_SESSION_CLOSED", "swing_table_session_closed"],
  ["TABLE_SESSION_STALE", "swing_table_session_stale"],
  ["TABLE_SESSION_CHANGED", "swing_table_session_changed"],
]);

export function assessSwingExecutionFailure(errorCode: unknown): DispatchSafetyOutcome {
  const rawCode = typeof errorCode === "string" ? errorCode : "";
  const stableCode = SWING_SESSION_FAILURE_CODES.get(rawCode);
  return {
    dispatchState: "partial",
    dispatchErrorCode: stableCode ?? "swing_execution_failed",
    diagnostic: {
      stage: "swing_execution",
      code: stableCode ? rawCode : "SWING_EXECUTION_FAILED",
    },
  };
}

const KNOWN_PERFORM_SWING_OUTCOMES = new Set([
  "swung",
  "swung_to_break",
  "swung_to_pool",
  "no_dealer",
  "no_dealer_available",
  "race_lost",
  "version_conflict",
  "already_in_transition",
  "not_found",
  "state_mismatch",
  "enforce_next_swing",
]);

/** Transport errors and malformed RPC responses must degrade the dispatch.
 * Business outcomes remain the caller's responsibility. */
export function assessPerformSwingResponse(
  data: unknown,
  error: unknown | null,
): DispatchSafetyOutcome | null {
  if (error) return assessCoreQueryFailure("perform_swing", error);
  const outcome = typeof data === "object" && data !== null
    ? (data as { outcome?: unknown }).outcome
    : null;
  if (typeof outcome === "string" && KNOWN_PERFORM_SWING_OUTCOMES.has(outcome)) {
    return null;
  }
  return {
    dispatchState: "partial",
    dispatchErrorCode: "perform_swing_invalid_response",
    diagnostic: { stage: "perform_swing", code: "INVALID_RPC_RESPONSE" },
  };
}

/** Maps a typed candidate snapshot failure without parsing an error message. */
export function assessCandidateSnapshotFailure(
  stage: string,
  status: "dependency_unavailable" | "query_failed",
  errorCode?: string,
): DispatchSafetyOutcome {
  const code = errorCode ?? `candidate_snapshot_${status}`;
  return {
    dispatchState: status === "dependency_unavailable"
      ? "dependency_unavailable"
      : "partial",
    dispatchErrorCode: code,
    diagnostic: {
      stage,
      code,
    },
  };
}

/** The canonical shortage snapshot is advisory, but unknown data must be visible
 * in dispatch state and must never be converted into a shortage notification. */
export function assessShortageAlertFailure(
  stage: string,
  status: "dependency_unavailable" | "query_failed",
  errorCode: string,
): DispatchSafetyOutcome {
  return {
    dispatchState: status === "dependency_unavailable" ? "dependency_unavailable" : "partial",
    dispatchErrorCode: errorCode,
    diagnostic: { stage, code: errorCode },
  };
}

export type DealerInventoryAssessment =
  | { dealerIds: string[]; failure: null }
  | { dealerIds: []; failure: DispatchSafetyOutcome };

export function assessDealerInventory(
  dealers: Array<{ id: string }> | null,
  error: unknown | null,
): DealerInventoryAssessment {
  if (error) {
    return {
      dealerIds: [],
      failure: assessCoreQueryFailure("dealer_inventory", error),
    };
  }
  return {
    dealerIds: (dealers ?? []).map((dealer) => dealer.id),
    failure: null,
  };
}

export type AvailableDealerCountAssessment =
  | { count: number; failure: null }
  | { count: null; failure: DispatchSafetyOutcome };

export function assessAvailableDealerCount(
  count: number | null,
  error: unknown | null,
): AvailableDealerCountAssessment {
  if (error || !isValidCount(count)) {
    return {
      count: null,
      failure: assessCoreQueryFailure("available_dealer_count", error),
    };
  }
  return { count, failure: null };
}

export interface QueryCountResult {
  count: number | null;
  error: unknown | null;
}

export type AllTablesOtAlertAssessment =
  | { shouldSend: true; totalActiveCount: number }
  | { shouldSend: false; failure: DispatchSafetyOutcome | null };

function isValidCount(count: number | null): count is number {
  return typeof count === "number" && Number.isInteger(count) && count >= 0;
}

export function assessAllTablesOtAlert(
  shortageAlertsAllowed: boolean,
  totalActive: QueryCountResult,
  nonOvertime: QueryCountResult,
): AllTablesOtAlertAssessment {
  if (!shortageAlertsAllowed) {
    return { shouldSend: false, failure: null };
  }
  if (totalActive.error) {
    return {
      shouldSend: false,
      failure: assessCoreQueryFailure("all_tables_ot_total_active", totalActive.error),
    };
  }
  if (nonOvertime.error) {
    return {
      shouldSend: false,
      failure: assessCoreQueryFailure("all_tables_ot_non_overtime", nonOvertime.error),
    };
  }
  if (!isValidCount(totalActive.count)) {
    return {
      shouldSend: false,
      failure: assessCoreQueryFailure("all_tables_ot_total_active", null),
    };
  }
  if (!isValidCount(nonOvertime.count)) {
    return {
      shouldSend: false,
      failure: assessCoreQueryFailure("all_tables_ot_non_overtime", null),
    };
  }

  return totalActive.count > 0 && nonOvertime.count === 0
    ? { shouldSend: true, totalActiveCount: totalActive.count }
    : { shouldSend: false, failure: null };
}

export function assessShortageNotifySetting(
  row: { shortage_notify_telegram?: boolean | null } | null,
  error: unknown | null,
): { notify: boolean; failure: DispatchSafetyOutcome | null } {
  if (error) {
    return {
      notify: false,
      failure: assessCoreQueryFailure("shortage_notify_setting", error),
    };
  }
  return { notify: row?.shortage_notify_telegram === true, failure: null };
}
