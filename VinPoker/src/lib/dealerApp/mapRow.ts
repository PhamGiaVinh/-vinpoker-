import type { DealerShiftView } from "@/types/dealerApp";
import type { ShiftStatus } from "@/types/shiftPlanner";

/** Map a raw dealer_shift_assignments row (snake_case) to the app view type.
 *  Planner assignments don't store game/table/venue, so those stay null in live
 *  mode (the mock layer supplies them for the demo). */
export function mapAssignmentRow(a: any): DealerShiftView {
  return {
    id: a.id,
    dealerId: a.dealer_id,
    clubId: a.club_id,
    workDate: a.work_date,
    scheduledStartAt: a.scheduled_start_at,
    scheduledEndAt: a.scheduled_end_at,
    role: a.role ?? "Dealer",
    status: a.status as ShiftStatus,
    checkedInAt: a.checked_in_at ?? null,
    checkedOutAt: a.checked_out_at ?? null,
    gameType: a.game_type ?? null,
    tableName: a.table_name ?? null,
    venueName: a.venue_name ?? null,
    floorName: a.floor_name ?? null,
  };
}
