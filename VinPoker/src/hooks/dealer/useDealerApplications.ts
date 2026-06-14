import { useQuery } from "@tanstack/react-query";
import { dealerKeys } from "@/lib/dealerApp/queryKeys";
import { mockApplications } from "@/lib/dealerApp/mockDealerData";
import { localTodayDate } from "@/lib/dealerApp/clock";
import type { CareerApplicationView } from "@/types/dealerApp";

/** The dealer's marketplace applications. Inc 5 = mock; the live branch (Inc 7)
 *  reads dealer_applications once Migration B is applied. */
export function useDealerApplications() {
  const today = localTodayDate();
  return useQuery({
    queryKey: dealerKeys.applications(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CareerApplicationView[]> => mockApplications(today),
  });
}
