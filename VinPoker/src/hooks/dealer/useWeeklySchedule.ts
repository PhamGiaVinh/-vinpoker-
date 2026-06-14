import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { localWeekBounds } from "@/lib/shiftPlanner";
import { dealerKeys } from "@/lib/dealerApp/queryKeys";
import { dealerDataSource } from "@/lib/dealerApp/dataSource";
import { DEALER_TZ_OFFSET_MINUTES } from "@/lib/dealerApp/constants";
import { mockWeekShifts } from "@/lib/dealerApp/mockDealerData";
import { mapAssignmentRow } from "@/lib/dealerApp/mapRow";
import type { DealerShiftView } from "@/types/dealerApp";

const db = supabase as unknown as { from: (table: string) => any };
const DAY_MS = 86_400_000;

/** All of the dealer's assignments overlapping the local week containing
 *  `anchorDate`. The −1 day low bound catches shifts (18–02 / 00–08) whose start
 *  straddles the week boundary. READ ONLY — dealer_shift_assignments only. */
export function useWeeklySchedule(dealerId: string | undefined, anchorDate: string) {
  const source = dealerDataSource();
  return useQuery({
    queryKey: dealerKeys.week(dealerId, anchorDate),
    enabled: source === "mock" || !!dealerId,
    staleTime: 60_000,
    queryFn: async (): Promise<DealerShiftView[]> => {
      if (source === "mock") return mockWeekShifts(anchorDate);
      if (!dealerId) return [];
      const { startMs, endMs } = localWeekBounds(anchorDate, DEALER_TZ_OFFSET_MINUTES);
      const lowIso = new Date(startMs - DAY_MS).toISOString();
      const highIso = new Date(endMs).toISOString();
      const { data, error } = await db
        .from("dealer_shift_assignments")
        .select(
          "id, club_id, dealer_id, work_date, scheduled_start_at, scheduled_end_at, role, status, checked_in_at, checked_out_at"
        )
        .eq("dealer_id", dealerId)
        .gte("scheduled_start_at", lowIso)
        .lt("scheduled_start_at", highIso);
      if (error) throw error;
      return (data ?? []).map(mapAssignmentRow);
    },
  });
}
