import { describe, expect, it } from "vitest";
import {
  historicalWorkerFailureStatus,
  isDeterministicHistoricalWorkerFailure,
  TRACKER_HISTORY_WORKER_MAX_BATCH,
} from "../../supabase/functions/_shared/trackerSettlement/historyWorkerPolicy.ts";

describe("historical display worker policy", () => {
  it("keeps each invocation bounded", () => {
    expect(TRACKER_HISTORY_WORKER_MAX_BATCH).toBe(20);
  });

  it("sends deterministic source errors to operator attention and retries transport errors", () => {
    expect(isDeterministicHistoricalWorkerFailure("historical_blind_snapshot_missing")).toBe(true);
    expect(historicalWorkerFailureStatus("stored_ending_stack_mismatch", false)).toBe("needs_attention");
    expect(historicalWorkerFailureStatus("refund_source_action_missing", false)).toBe("needs_attention");
    expect(historicalWorkerFailureStatus("incomplete_showdown_cards", true)).toBe("needs_attention");
    expect(historicalWorkerFailureStatus("fetch_failed", false)).toBe("pending");
    expect(historicalWorkerFailureStatus("queue_lease_lost", false)).toBe("pending");
  });
});
