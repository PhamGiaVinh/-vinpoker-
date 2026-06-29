import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type FnbClubRow = { id: string; name: string };

/**
 * F&B club loader — mirrors `useOperatorClubs` but scoped via the live `fnb_club_ids` RPC
 * (memberships ∪ owned clubs ∪ all-if-super_admin). `clubs === null` = still loading; `[]` = loaded,
 * none assigned (show the "chưa được phân công F&B" state). Single club → caller auto-selects;
 * multiple → caller shows a picker. `fnb_*` isn't in generated types yet → `supabase.rpc as any`.
 */
export function useFnbClubs() {
  const { user, loading: authLoading } = useAuth();
  const [clubs, setClubs] = useState<FnbClubRow[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: ids } = await (supabase.rpc as any)("fnb_club_ids", { _user_id: user.id });
      const idArr = (ids ?? []).map((r: any) => (typeof r === "string" ? r : r.fnb_club_ids ?? r));
      if (!idArr.length) {
        if (!cancelled) setClubs([]);
        return;
      }
      const { data: cs } = await supabase.from("clubs").select("id,name").in("id", idArr);
      if (!cancelled) setClubs((cs ?? []) as FnbClubRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const clubIds = (clubs ?? []).map((c) => c.id);
  return { loading: authLoading, user, clubs, clubIds };
}
