import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type OperatorClubRow = { id: string; name: string };

/**
 * Shared operator club loader — mirrors the proven logic in CashierDashboard:
 *  - cashier_club_ids  → cashier/club-owner clubs (`clubs`/`clubIds`)
 *  - dealer_control_club_ids → dealer-control clubs (`dealerClubIds`)
 *
 * Returned `clubs === null` means "still loading"; `[]` means "loaded, none assigned".
 * Used by the focused operator pages (Floor, Dealer Swing) so they share one
 * club-scoping source of truth and stay in parity with /cashier.
 */
export function useOperatorClubs() {
  const { user, loading: authLoading } = useAuth();
  const [clubs, setClubs] = useState<OperatorClubRow[] | null>(null);
  const [dealerClubIds, setDealerClubIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setClubs(authLoading ? null : []);
      setDealerClubIds([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setClubs(null);
    setError(null);
    (async () => {
      const [cashierResult, floorResult, dealerResult] = await Promise.all([
        supabase.rpc("cashier_club_ids", { _user_id: user.id }),
        supabase.rpc("floor_club_ids", { _user_id: user.id }),
        supabase.rpc("dealer_control_club_ids", { _user_id: user.id }),
      ]);

      const firstError = cashierResult.error ?? floorResult.error ?? dealerResult.error;
      if (firstError) {
        if (!cancelled) {
          setClubs([]);
          setDealerClubIds([]);
          setError("Không tải được phạm vi CLB. Vui lòng thử lại.");
        }
        return;
      }

      const idArr = Array.from(new Set([...(cashierResult.data ?? []), ...(floorResult.data ?? [])]));
      if (!idArr.length) {
        if (!cancelled) setClubs([]);
      } else {
        const { data: cs } = await supabase.from("clubs").select("id,name").in("id", idArr);
        if (!cancelled) setClubs((cs ?? []) as OperatorClubRow[]);
      }

      if (!cancelled) {
        setDealerClubIds(dealerResult.data ?? []);
      }
    })();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  const clubIds = (clubs ?? []).map((c) => c.id);

  return { loading: authLoading || clubs === null, user, clubs, clubIds, dealerClubIds, error };
}
