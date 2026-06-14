// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner — coverage-by-hour
// ═══════════════════════════════════════════════════════════════════════════════

import type { CoverageBucket, DraftAssignment, SchedulerConfig } from "@/types/shiftPlanner";
import { eachCoveredHour } from "./time";

/** Build 24 local-hour buckets comparing assigned headcount to requirement.
 *  Each assignment contributes +1 to every hour bucket it spans (midnight-wrap
 *  aware via eachCoveredHour). */
export function computeCoverageByHour(
  assignments: DraftAssignment[],
  requirementByHour: SchedulerConfig["requirementByHour"],
  tzOffsetMinutes: number
): CoverageBucket[] {
  const assignedByHour: Record<number, number> = {};
  for (const a of assignments) {
    for (const h of eachCoveredHour(a.scheduledStartAt, a.scheduledEndAt, tzOffsetMinutes)) {
      assignedByHour[h] = (assignedByHour[h] ?? 0) + 1;
    }
  }

  const buckets: CoverageBucket[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const required = requirementByHour[hour] ?? 0;
    const assigned = assignedByHour[hour] ?? 0;
    const deficit = required - assigned;
    const status: CoverageBucket["status"] =
      deficit > 0 ? "under" : assigned > required ? "over" : "ok";
    buckets.push({ hour, required, assigned, deficit, status });
  }
  return buckets;
}

/** Chip severity for the coverage strip (matches the V2.1 mock):
 *  deficit ≤ 0 → ok, exactly 1 short → warn, ≥2 short → bad. */
export function coverageSeverity(bucket: CoverageBucket): "ok" | "warn" | "bad" {
  if (bucket.deficit <= 0) return "ok";
  if (bucket.deficit === 1) return "warn";
  return "bad";
}
