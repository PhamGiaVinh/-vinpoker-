export type VerifiedTournamentScope = {
  status: "checking" | "allowed" | "denied";
  tournamentId: string | null;
  scopeFingerprint: string;
};

export function floorScopeFingerprint(clubIds: string[]): string {
  return [...clubIds].sort().join("|");
}

export function isCurrentTournamentScope(
  verification: VerifiedTournamentScope,
  tournamentId: string | undefined,
  scopeFingerprint: string,
): boolean {
  return verification.status === "allowed"
    && verification.tournamentId === tournamentId
    && verification.scopeFingerprint === scopeFingerprint;
}
