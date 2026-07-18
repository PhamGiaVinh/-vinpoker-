import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type OperatorClubRow = { id: string; name: string };
export type FloorOperatorScopeRow = {
  club_id: string;
  can_owner: boolean;
  can_cashier: boolean;
  can_floor: boolean;
};

/**
 * Caller-bound Floor/Cashier scope. The RPC derives every capability from
 * auth.uid(), clubs.owner_id, club_cashiers, and club_floors.
 */
export function useOperatorClubs() {
  const { user, loading: authLoading } = useAuth();
  const [clubs, setClubs] = useState<OperatorClubRow[] | null>(null);
  const [cashierClubIds, setCashierClubIds] = useState<string[]>([]);
  const [floorClubIds, setFloorClubIds] = useState<string[]>([]);
  const [dealerClubIds, setDealerClubIds] = useState<string[]>([]);
  const [scope, setScope] = useState<FloorOperatorScopeRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setClubs(authLoading ? null : []);
      setCashierClubIds([]);
      setFloorClubIds([]);
      setDealerClubIds([]);
      setScope([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setClubs(null);
    setCashierClubIds([]);
    setFloorClubIds([]);
    setDealerClubIds([]);
    setScope([]);
    setError(null);

    void (async () => {
      const [scopeResult, dealerResult] = await Promise.all([
        supabase.rpc("get_my_floor_operator_scope"),
        supabase.rpc("dealer_control_club_ids", { _user_id: user.id }),
      ]);
      if (scopeResult.error) {
        if (!cancelled) {
          setClubs([]);
          setCashierClubIds([]);
          setFloorClubIds([]);
          setDealerClubIds([]);
          setScope([]);
          setError("Không tải được phạm vi CLB. Vui lòng thử lại.");
        }
        return;
      }

      const nextScope = (scopeResult.data ?? []) as FloorOperatorScopeRow[];
      const nextDealerClubIds = dealerResult.error ? [] : (dealerResult.data ?? []);
      const clubIds = Array.from(new Set([
        ...nextScope.map((row) => row.club_id),
        ...nextDealerClubIds,
      ]));
      const nextCashierClubIds = nextScope
        .filter((row) => row.can_owner || row.can_cashier)
        .map((row) => row.club_id);
      const nextFloorClubIds = nextScope
        .filter((row) => row.can_owner || row.can_floor)
        .map((row) => row.club_id);

      if (!cancelled) {
        setScope(nextScope);
        setCashierClubIds(nextCashierClubIds);
        setFloorClubIds(nextFloorClubIds);
        setDealerClubIds(nextDealerClubIds);
      }

      if (!clubIds.length) {
        if (!cancelled) setClubs([]);
        return;
      }

      const { data: clubRows, error: clubsError } = await supabase
        .from("clubs")
        .select("id,name")
        .in("id", clubIds);
      if (clubsError) {
        if (!cancelled) {
          setClubs([]);
          setError("Không tải được tên CLB. Vui lòng thử lại.");
        }
        return;
      }

      if (!cancelled) setClubs((clubRows ?? []) as OperatorClubRow[]);
    })();

    return () => { cancelled = true; };
  }, [user, authLoading]);

  const clubIds = (clubs ?? []).map((club) => club.id);
  const operatorClubIds = scope.map((row) => row.club_id);
  const hasOpsAccess = scope.some((row) => row.can_owner || row.can_cashier || row.can_floor);
  const hasCashierAccess = scope.some((row) => row.can_owner || row.can_cashier);
  const hasOwnerAccess = scope.some((row) => row.can_owner);

  return {
    loading: authLoading || clubs === null,
    user,
    clubs,
    clubIds,
    operatorClubIds,
    cashierClubIds,
    floorClubIds,
    dealerClubIds,
    scope,
    hasOpsAccess,
    hasCashierAccess,
    hasOwnerAccess,
    error,
  };
}
