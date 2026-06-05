import type { DealerAttendance, DealerAssignment } from "@/hooks/useDealerSwing";

/**
 * Compute live worked minutes for each dealer from assignment timestamps.
 * Assigned dealers → elapsed minutes since assigned_at.
 * Others → stored worked_minutes_since_last_break (last session).
 *
 * Pure function — safe from minifier tree-shaking because it is exported
 * from its own module and imported by every consumer.
 */
export function calculateLiveWorkedMinutes(
  dealers: DealerAttendance[],
  assignments: DealerAssignment[],
  nowMs: number
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const d of dealers) {
    const assignment = assignments.find(
      (a) => a.attendance_id === d.id && a.status === "assigned"
    );
    if (assignment?.assigned_at) {
      const elapsedMin = (nowMs - new Date(assignment.assigned_at).getTime()) / 60000;
      map[d.id] = Math.max(0, Math.floor(elapsedMin));
    } else {
      const stored = d.worked_minutes_since_last_break ?? 0;
      const STALE_DATA_CAP = 180;
      map[d.id] = stored > STALE_DATA_CAP ? 0 : stored;
    }
  }
  return map;
}
