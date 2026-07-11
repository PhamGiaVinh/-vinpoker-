import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FinanceSummaryRpc {
  revenue: {
    total: number;
    rake: number;
    serviceFee: number;
    stakingFees: number;
    payoutFees: number;
    fnb: number;
  };
  cost: {
    payrollNet: number;
    payrollGross: number;
    ptWagePaid: number;
    fnbCogs: number;
    compCogs: number;
    clubExpenses: number;
  };
  net: number;
}

/**
 * RPC-ONLY finance summary for the accountant workspace. Deliberately NO client-side
 * fallback: useClubFinanceSummary's fallback scans clubs by owner_id and reads broad
 * tables an accountant has no access to — it would silently render zeros (review P0).
 * The RPC (get_club_finance_summary, accountant scope via 20261236000000) either
 * answers or raises 42501 — the tab shows the explicit reason, never fake zeros.
 */
export function useFinanceSummaryRpcOnly(clubId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ["accountant", "financeSummary", clubId ?? "", from, to],
    enabled: !!clubId,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<FinanceSummaryRpc> => {
      const { data, error } = await (supabase.rpc as any)("get_club_finance_summary", {
        p_from: from,
        p_to: to,
        p_club_id: clubId,
      });
      if (error) throw error;
      const rev = data?.revenue ?? {};
      const cost = data?.cost ?? {};
      return {
        revenue: {
          total: Number(rev.total ?? 0),
          rake: Number(rev.rake ?? 0),
          serviceFee: Number(rev.serviceFee ?? 0),
          stakingFees: Number(rev.stakingFees ?? 0),
          payoutFees: Number(rev.payoutFees ?? 0),
          fnb: Number(rev.fnb ?? 0),
        },
        cost: {
          payrollNet: Number(cost.payrollNet ?? 0),
          payrollGross: Number(cost.payrollGross ?? 0),
          ptWagePaid: Number(cost.ptWagePaid ?? 0),
          fnbCogs: Number(cost.fnbCogs ?? 0),
          compCogs: Number(cost.compCogs ?? 0),
          clubExpenses: Number(cost.clubExpenses ?? 0),
        },
        net: Number(data?.net ?? 0),
      };
    },
  });
}
