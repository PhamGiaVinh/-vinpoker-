export const TRACKER_HISTORY_WORKER_MAX_BATCH = 20;

const DETERMINISTIC_CODES = new Set([
  "invalid_historical_hand",
  "invalid_historical_source",
  "historical_blind_snapshot_missing",
  "incomplete_showdown_cards",
  "duplicate_card",
  "invalid_community_card",
  "invalid_hole_card",
  "refund_source_action_missing",
  "stored_ending_stack_mismatch",
  "stored_elimination_mismatch",
  "historical_player_projection_mismatch",
]);

export function isDeterministicHistoricalWorkerFailure(code: string): boolean {
  return code.startsWith("historical_") || DETERMINISTIC_CODES.has(code);
}

export function historicalWorkerFailureStatus(code: string, verifierRejected: boolean): "pending" | "needs_attention" {
  return verifierRejected || isDeterministicHistoricalWorkerFailure(code) ? "needs_attention" : "pending";
}
