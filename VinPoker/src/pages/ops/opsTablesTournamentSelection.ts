export interface OpsTablesTournamentOption {
  id: string;
}

export interface ResolveOpsTablesTournamentIdInput {
  currentTournamentId: string | null;
  tournamentOptions: readonly OpsTablesTournamentOption[];
  selectedClubId: string | null;
  operatorClubsLoading: boolean;
  tournamentsLoading: boolean;
}

export function resolveOpsTablesTournamentId({
  currentTournamentId,
  tournamentOptions,
  selectedClubId,
  operatorClubsLoading,
  tournamentsLoading,
}: ResolveOpsTablesTournamentIdInput): string | null {
  if (tournamentOptions.length === 0) {
    const selectionInputsArePending = operatorClubsLoading
      || selectedClubId === null
      || tournamentsLoading;
    return selectionInputsArePending ? currentTournamentId : null;
  }
  if (
    currentTournamentId !== null
    && tournamentOptions.some((tournament) => tournament.id === currentTournamentId)
  ) {
    return currentTournamentId;
  }
  return tournamentOptions[0].id;
}
