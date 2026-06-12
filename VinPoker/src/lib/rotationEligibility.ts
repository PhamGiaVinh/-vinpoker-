/**
 * rotationEligibility — candidate classification for the "Đổi & CHỐT dealer
 * thay thế" modal (Dealer Swing, UIUX Phase 4).
 *
 * ADVISORY ONLY. This mirrors the server-side eligibility guard in the
 * set_rotation_slot_dealer RPC for display purposes (grouping, labels,
 * disabled reasons). The RPC result is AUTHORITATIVE: when the server returns
 * `not_eligible` with its own `eligible_at`, the UI must trust and show the
 * server value — never override it with this classifier's output.
 *
 * Business rule (owner spec):
 *   - Minimum rest after leaving a table: `restMinutes` (default 10).
 *   - Telegram/arrival buffer before entry: `bufferMinutes` (default 3,
 *     mirrors ANNOUNCE_LEAD_MS in the rotation planner).
 *   - A resting dealer is still a valid FUTURE replacement when
 *     `last_release + rest + buffer <= planned swing time`.
 *   - A fully-rested dealer is always time-eligible, even when the planned
 *     swing time is already in the past (overdue table).
 */

export type CandidateGroup =
  | "ready_now" // available and rest complete — selectable
  | "eligible_before_swing" // still resting, but rest+buffer completes before the planned swing — selectable
  | "resting_not_eligible" // resting and cannot make the planned swing — disabled
  | "busy_assigned" // currently dealing a table — disabled
  | "busy_pre_assigned" // already CHỐT for another table — disabled
  | "on_break" // on an explicit break — disabled (break must end first)
  | "unavailable"; // checked out / unknown state — disabled

export interface CandidateClassification {
  group: CandidateGroup;
  /** When the dealer completes minimum rest (ms epoch); null when no release is recorded. */
  eligibleAtMs: number | null;
  /** eligibleAtMs + buffer — earliest moment the dealer could enter a table. */
  earliestEntryMs: number | null;
}

export interface ClassifyCandidateInput {
  /** dealer_attendance.last_released_at (ISO) — null = no release recorded (treated as long-rested). */
  lastReleasedAt: string | null;
  /** dealer_attendance.current_state */
  currentState: string;
  /** dealer_attendance.status — anything other than "checked_in" is unavailable. */
  attendanceStatus: string;
  /** The slot's planned_relief_at (ms epoch). */
  plannedReliefAtMs: number;
  /** swing_config.min_inter_swing_rest_minutes (>=10). */
  restMinutes: number;
  /** Announce/arrival lead, default 3 (ANNOUNCE_LEAD_MS). */
  bufferMinutes?: number;
  nowMs: number;
}

export function classifyCandidate(input: ClassifyCandidateInput): CandidateClassification {
  const {
    lastReleasedAt,
    currentState,
    attendanceStatus,
    plannedReliefAtMs,
    restMinutes,
    bufferMinutes = 3,
    nowMs,
  } = input;

  const releasedMs = lastReleasedAt ? new Date(lastReleasedAt).getTime() : null;
  const eligibleAtMs = releasedMs != null ? releasedMs + restMinutes * 60_000 : null;
  const earliestEntryMs = eligibleAtMs != null ? eligibleAtMs + bufferMinutes * 60_000 : null;

  if (attendanceStatus !== "checked_in") {
    return { group: "unavailable", eligibleAtMs, earliestEntryMs };
  }

  switch (currentState) {
    case "assigned":
      return { group: "busy_assigned", eligibleAtMs, earliestEntryMs };
    case "pre_assigned":
      return { group: "busy_pre_assigned", eligibleAtMs, earliestEntryMs };
    case "on_break":
      return { group: "on_break", eligibleAtMs, earliestEntryMs };
    case "available":
      break;
    default:
      return { group: "unavailable", eligibleAtMs, earliestEntryMs };
  }

  // Available: time-based classification (mirrors the RPC guard).
  if (eligibleAtMs == null || eligibleAtMs <= nowMs) {
    // No release recorded, or rest already complete → always acceptable,
    // including for overdue tables whose planned time is in the past.
    return { group: "ready_now", eligibleAtMs, earliestEntryMs };
  }
  if (earliestEntryMs != null && earliestEntryMs <= plannedReliefAtMs) {
    return { group: "eligible_before_swing", eligibleAtMs, earliestEntryMs };
  }
  return { group: "resting_not_eligible", eligibleAtMs, earliestEntryMs };
}
