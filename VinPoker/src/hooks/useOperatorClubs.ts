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

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: ids } = await supabase.rpc("cashier_club_ids", { _user_id: user.id });
      const idArr = (ids ?? []).map((r: any) => (typeof r === "string" ? r : r.cashier_club_ids ?? r));
      if (!idArr.length) {
        if (!cancelled) setClubs([]);
      } else {
        const { data: cs } = await supabase.from("clubs").select("id,name").in("id", idArr);
        if (!cancelled) setClubs((cs ?? []) as OperatorClubRow[]);
      }

      const { data: dcIds } = await supabase.rpc("dealer_control_club_ids", { _user_id: user.id });
      if (!cancelled) {
        setDealerClubIds((dcIds ?? []).map((r: any) => (typeof r === "string" ? r : r.dealer_control_club_ids ?? r)));
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const clubIds = (clubs ?? []).map((c) => c.id);

  return { loading: authLoading, user, clubs, clubIds, dealerClubIds };
}
