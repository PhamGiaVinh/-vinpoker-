/**
 * Archive discovery is narrowed in the client for non-admins. RLS remains the
 * data authority, and super-admins must not be narrowed by incidental clubs.
 */
export function archiveTournamentClubScope(input: {
  isAdmin: boolean;
  trackerClubIds: readonly string[];
}): string[] | null {
  if (input.isAdmin) return null;
  return [...input.trackerClubIds];
}
