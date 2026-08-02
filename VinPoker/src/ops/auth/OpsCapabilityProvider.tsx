import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";

export type OpsCapabilityRow = {
  club_id: string;
  can_owner: boolean;
  can_cashier: boolean;
  can_floor: boolean;
};

export type OpsClubMetadata = {
  id: string;
  name: string;
};

type OpsCapabilityContextValue = {
  loading: boolean;
  scopeError: string | null;
  metadataError: string | null;
  scope: OpsCapabilityRow[];
  clubs: OpsClubMetadata[];
  operatorClubIds: string[];
  floorClubIds: string[];
  cashierClubIds: string[];
  hasOwnerAccess: boolean;
  hasFloorAccess: boolean;
  hasCashierAccess: boolean;
  hasAnyAccess: boolean;
  refresh: () => void;
};

const OpsCapabilityContext = createContext<OpsCapabilityContextValue | null>(null);

export function OpsCapabilityProvider({ children }: { children: ReactNode }) {
  const client = useSupabaseClient();
  const { user, loading: authLoading } = useOpsAuth();
  const [scope, setScope] = useState<OpsCapabilityRow[]>([]);
  const [clubs, setClubs] = useState<OpsClubMetadata[]>([]);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }
    if (!user) {
      setScope([]);
      setClubs([]);
      setScopeError(null);
      setMetadataError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setScope([]);
    setClubs([]);
    setScopeError(null);
    setMetadataError(null);

    void (async () => {
      const scopeResult = await client.rpc("get_my_floor_operator_scope");
      if (cancelled) return;

      if (scopeResult.error) {
        setScopeError("Không tải được phạm vi vận hành. Vui lòng thử lại.");
        setLoading(false);
        return;
      }

      const nextScope = (scopeResult.data ?? []) as OpsCapabilityRow[];
      setScope(nextScope);
      const clubIds = [...new Set(nextScope.map((row) => row.club_id))];

      if (!clubIds.length) {
        setLoading(false);
        return;
      }

      const metadataResult = await client.from("clubs").select("id,name").in("id", clubIds);
      if (cancelled) return;

      if (metadataResult.error) {
        // Capability remains authoritative even when RLS or a transient error
        // prevents the optional display-name query.
        setMetadataError("Tên CLB tạm thời chưa tải được.");
        setClubs([]);
      } else {
        setClubs((metadataResult.data ?? []) as OpsClubMetadata[]);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, client, revision, user]);

  const value = useMemo<OpsCapabilityContextValue>(() => {
    const operatorClubIds = scope.map((row) => row.club_id);
    const floorClubIds = scope
      .filter((row) => row.can_owner || row.can_floor)
      .map((row) => row.club_id);
    const cashierClubIds = scope
      .filter((row) => row.can_owner || row.can_cashier)
      .map((row) => row.club_id);
    const hasOwnerAccess = scope.some((row) => row.can_owner);
    const hasFloorAccess = floorClubIds.length > 0;
    const hasCashierAccess = cashierClubIds.length > 0;

    return {
      loading: authLoading || loading,
      scopeError,
      metadataError,
      scope,
      clubs,
      operatorClubIds,
      floorClubIds,
      cashierClubIds,
      hasOwnerAccess,
      hasFloorAccess,
      hasCashierAccess,
      hasAnyAccess: hasFloorAccess || hasCashierAccess,
      refresh,
    };
  }, [authLoading, clubs, loading, metadataError, refresh, scope, scopeError]);

  return <OpsCapabilityContext.Provider value={value}>{children}</OpsCapabilityContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOpsCapabilities(): OpsCapabilityContextValue {
  const value = useContext(OpsCapabilityContext);
  if (!value) throw new Error("useOpsCapabilities must be used inside OpsCapabilityProvider.");
  return value;
}
