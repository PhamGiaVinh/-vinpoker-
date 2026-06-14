import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dealerKeys } from "@/lib/dealerApp/queryKeys";
import { dealerDataSource } from "@/lib/dealerApp/dataSource";
import { mockTodayShift } from "@/lib/dealerApp/mockDealerData";
import { mapAssignmentRow } from "@/lib/dealerApp/mapRow";
import type { DealerShiftView } from "@/types/dealerApp";

const db = supabase as unknown as { from: (table: string) => any };

/** The dealer's single live assignment for `workDate` (planner enforces one live
 *  assignment per dealer per day). READ ONLY — dealer_shift_assignments only;
 *  RLS limits rows to the caller's own. */
export function useTodayShift(dealerId: string | undefined, workDate: string) {
  const source = dealerDataSource();
  return useQuery({
    queryKey: dealerKeys.today(dealerId, workDate),
    enabled: source === "mock" || !!dealerId,
    staleTime: 30_000,
    queryFn: async (): Promise<DealerShiftView | null> => {
      if (source === "mock") return mockTodayShift(workDate, dealerId);
      if (!dealerId) return null;
      const { data, error } = await db
        .from("dealer_shift_assignments")
        .select(
          "id, club_id, dealer_id, work_date, scheduled_start_at, scheduled_end_at, role, status, checked_in_at, checked_out_at"
        )
        .eq("dealer_id", dealerId)
        .eq("work_date", workDate)
        .in("status", ["published", "confirmed", "checked_in", "closed"])
        .order("scheduled_start_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? mapAssignmentRow(data) : null;
    },
  });
}
