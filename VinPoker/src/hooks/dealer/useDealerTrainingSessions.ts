import { useQuery } from "@tanstack/react-query";
import { dealerKeys } from "@/lib/dealerApp/queryKeys";
import { mockTrainingSessions } from "@/lib/dealerApp/mockDealerData";
import { localTodayDate } from "@/lib/dealerApp/clock";
import type { CareerSessionView } from "@/types/dealerApp";

/** Interview / training sessions for the dealer. Inc 5 = mock; the live branch
 *  (Inc 7) reads dealer_program_sessions once Migration B is applied. */
export function useDealerTrainingSessions() {
  const today = localTodayDate();
  return useQuery({
    queryKey: dealerKeys.trainingSessions(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CareerSessionView[]> => mockTrainingSessions(today),
  });
}
