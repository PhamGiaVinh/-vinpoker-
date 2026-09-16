import { useEffect, useMemo, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import {
  currentMonthFinanceRange,
  loadFinanceSummary,
  type FinanceSummaryRead,
} from "@/ops/finance/financeReadAdapter";
import { FinanceWorkspaceView } from "@/ops/finance/FinanceWorkspaceView";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import { OPS_CASHIER_MUTATIONS_ENABLED } from "@/ops/opsMutations";
import CashierCashflowPanel from "./CashierCashflowPanel";

const range = currentMonthFinanceRange();

export default function OpsFinanceWorkspace() {
  const client = useSupabaseClient();
  const capabilities = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const financeClubIds = capabilities.moduleClubIds("finance");
  const clubId = selectedClubId
    && (capabilities.isSuperAdmin || financeClubIds.includes(selectedClubId))
    ? selectedClubId
    : null;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    clubId: string | null;
    loading: boolean;
    summary: FinanceSummaryRead | null;
    blockedReason: string | null;
  }>({ clubId: null, loading: true, summary: null, blockedReason: null });

  useEffect(() => {
    if (!clubId || capabilities.loading || capabilities.scopeError) return;
    let active = true;
    setState({ clubId, loading: true, summary: null, blockedReason: null });
    void loadFinanceSummary(client, clubId, range).then((summary) => {
      if (active) setState({ clubId, loading: false, summary, blockedReason: null });
    }).catch((error: unknown) => {
      if (active) setState({ clubId, loading: false, summary: null, blockedReason: safeErrorCode(error) });
    });
    return () => { active = false; };
  }, [capabilities.loading, capabilities.scopeError, client, clubId, revision]);

  const clubName = useMemo(
    () => capabilities.clubs.find((club) => club.id === clubId)?.name ?? "CLB đã chọn",
    [capabilities.clubs, clubId],
  );

  return (<>
    <FinanceWorkspaceView
      clubName={clubName}
      range={range}
      summary={clubId && state.clubId === clubId ? state.summary : null}
      loading={capabilities.loading || state.clubId !== clubId || state.loading}
      blockedReason={capabilities.scopeError ?? (!clubId ? "FINANCE_CLUB_SCOPE_REQUIRED" : state.clubId === clubId ? state.blockedReason : null)}
      onRefresh={() => setRevision((value) => value + 1)}
    />
    {clubId && OPS_CASHIER_MUTATIONS_ENABLED && <CashierCashflowPanel key={`${clubId}:${range.from}:${range.to}`} clubId={clubId} range={range} />}
  </>);
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "FINANCE_SUMMARY_RPC_UNAVAILABLE";
  return /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "FINANCE_SUMMARY_RPC_UNAVAILABLE";
}
