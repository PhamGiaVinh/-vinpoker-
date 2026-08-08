import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import {
  loadChipOpsTournamentOptions,
  loadIssuedChipInventory,
  type ChipOpsTournamentOption,
  type IssuedChipInventory,
} from "@/ops/chip-ops/chipOpsReadAdapter";
import { ChipOpsWorkspaceView } from "@/ops/chip-ops/ChipOpsWorkspaceView";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";

type WorkspaceState = {
  loading: boolean;
  tournaments: ChipOpsTournamentOption[];
  inventory: IssuedChipInventory | null;
  errorCode: string | null;
};

export default function OpsChipOpsWorkspace() {
  const client = useSupabaseClient();
  const capabilities = useOpsCapabilities();
  const { selectedClubId } = useOpsWorkspace();
  const [params, setParams] = useSearchParams();
  const chipClubIds = capabilities.moduleClubIds("chip-ops");
  const clubId = selectedClubId
    && (capabilities.isSuperAdmin || chipClubIds.includes(selectedClubId))
    ? selectedClubId
    : null;
  const selectedTournamentId = params.get("t") ?? "";
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<WorkspaceState>({
    loading: true,
    tournaments: [],
    inventory: null,
    errorCode: null,
  });

  const load = useCallback(async () => {
    if (!clubId) return;
    setState((current) => ({ ...current, loading: true, errorCode: null }));
    try {
      const tournaments = await loadChipOpsTournamentOptions(client, clubId);
      if (selectedTournamentId && !tournaments.some((row) => row.id === selectedTournamentId)) {
        setState({ loading: false, tournaments, inventory: null, errorCode: "CHIP_TOURNAMENT_SCOPE_INVALID" });
        return;
      }
      const inventory = selectedTournamentId
        ? await loadIssuedChipInventory(client, selectedTournamentId)
        : null;
      setState({ loading: false, tournaments, inventory, errorCode: null });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        inventory: null,
        errorCode: safeErrorCode(error),
      }));
    }
  }, [client, clubId, selectedTournamentId]);

  useEffect(() => {
    if (!clubId || capabilities.loading || capabilities.scopeError) return;
    void load();
  }, [capabilities.loading, capabilities.scopeError, clubId, load, revision]);

  const clubName = useMemo(
    () => capabilities.clubs.find((club) => club.id === clubId)?.name ?? "CLB đã chọn",
    [capabilities.clubs, clubId],
  );

  const onSelectTournament = (tournamentId: string) => {
    const next = new URLSearchParams(params);
    if (tournamentId) next.set("t", tournamentId);
    else next.delete("t");
    setParams(next, { replace: true });
  };

  return (
    <ChipOpsWorkspaceView
      clubName={clubName}
      tournaments={state.tournaments}
      selectedTournamentId={selectedTournamentId}
      inventory={clubId ? state.inventory : null}
      loading={capabilities.loading || state.loading}
      errorCode={capabilities.scopeError ?? (!clubId ? "CHIP_OPS_CLUB_SCOPE_REQUIRED" : state.errorCode)}
      onSelectTournament={onSelectTournament}
      onRefresh={() => setRevision((value) => value + 1)}
    />
  );
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "CHIP_OPS_READ_FAILED";
  return /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "CHIP_OPS_READ_FAILED";
}
