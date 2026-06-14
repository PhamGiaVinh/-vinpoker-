import { useQuery } from "@tanstack/react-query";
import { dealerKeys } from "@/lib/dealerApp/queryKeys";
import { mockCareerPrograms } from "@/lib/dealerApp/mockDealerData";
import type { CareerProgramView } from "@/types/dealerApp";

/** Open dealer-marketplace programs. Inc 1 = mock; the live branch (Inc 7) reads
 *  recruitment_programs / training_programs once Migration B is applied. */
export function useDealerCareers() {
  return useQuery({
    queryKey: dealerKeys.careers(),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CareerProgramView[]> => mockCareerPrograms(),
  });
}
