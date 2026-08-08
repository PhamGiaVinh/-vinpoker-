import { useCallback, useEffect, useMemo, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import {
  currentMonthFinanceRange,
  loadFinanceSummary,
  type FinanceSummaryRead,
} from "@/ops/finance/financeReadAdapter";
import { FinanceWorkspaceView } from "@/ops/finance/FinanceWorkspaceView";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";

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
    loading: boolean;
    summary: FinanceSummaryRead | null;
    blockedReason: string | null;
  }>({ loading: true, summary: null, blockedReason: null });

  const load = useCallback(async () => {
    if (!clubId) return;
    setState({ loading: true, summary: null, blockedReason: null });
    try {
      const summary = await loadFinanceSummary(client, clubId, range);
      setState({ loading: false, summary, blockedReason: null });
    } catch (error) {
      setState({ loading: false, summary: null, blockedReason: safeErrorCode(error) });
    }
  }, [client, clubId]);

  useEffect(() => {
    if (!clubId || capabilities.loading || capabilities.scopeError) return;
    void load();
  }, [capabilities.loading, capabilities.scopeError, clubId, load, revision]);

  const clubName = useMemo(
    () => capabilities.clubs.find((club) => club.id === clubId)?.name ?? "CLB đã chọn",
    [capabilities.clubs, clubId],
  );

  return (
    <FinanceWorkspaceView
      clubName={clubName}
      range={range}
      summary={clubId ? state.summary : null}
      loading={capabilities.loading || state.loading}
      blockedReason={capabilities.scopeError ?? (!clubId ? "FINANCE_CLUB_SCOPE_REQUIRED" : state.blockedReason)}
      onRefresh={() => setRevision((value) => value + 1)}
    />
  );
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "FINANCE_SUMMARY_RPC_UNAVAILABLE";
  return /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "FINANCE_SUMMARY_RPC_UNAVAILABLE";
}
