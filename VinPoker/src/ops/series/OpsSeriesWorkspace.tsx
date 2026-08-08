import { useCallback, useEffect, useMemo, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { loadSeriesReadModel, type SeriesReadModel } from "@/ops/series/seriesReadAdapter";
import { SeriesWorkspaceView } from "@/ops/series/SeriesWorkspaceView";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";

export default function OpsSeriesWorkspace() {
  const client = useSupabaseClient();
  const capabilities = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const seriesClubIds = capabilities.moduleClubIds("series");
  const clubId = selectedClubId
    && (capabilities.isSuperAdmin || seriesClubIds.includes(selectedClubId))
    ? selectedClubId
    : null;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    loading: boolean;
    model: SeriesReadModel | null;
    errorCode: string | null;
  }>({ loading: true, model: null, errorCode: null });

  const load = useCallback(async () => {
    if (!clubId) return;
    setState({ loading: true, model: null, errorCode: null });
    try {
      const model = await loadSeriesReadModel(client, clubId);
      setState({ loading: false, model, errorCode: null });
    } catch (error) {
      setState({ loading: false, model: null, errorCode: safeErrorCode(error) });
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
    <SeriesWorkspaceView
      clubName={clubName}
      model={clubId ? state.model : null}
      loading={capabilities.loading || state.loading}
      errorCode={capabilities.scopeError ?? (!clubId ? "SERIES_CLUB_SCOPE_REQUIRED" : state.errorCode)}
      onRefresh={() => setRevision((value) => value + 1)}
    />
  );
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "SERIES_READ_RPC_UNAVAILABLE";
  return /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "SERIES_READ_RPC_UNAVAILABLE";
}
