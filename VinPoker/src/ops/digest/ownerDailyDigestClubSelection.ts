export type OwnerDailyDigestAccessibleClub = {
  id: string;
  name: string;
};

/**
 * A `club` query parameter is an explicit scope request. It must never fall
 * back to another accessible club when it is absent from the server-scoped
 * list; doing so makes a denied deep link look like a successful one.
 */
export function selectOwnerDailyDigestClub(
  clubs: readonly OwnerDailyDigestAccessibleClub[],
  requestedClubId: string | null,
): OwnerDailyDigestAccessibleClub | null {
  if (requestedClubId === null) return clubs[0] ?? null;
  return clubs.find((club) => club.id === requestedClubId) ?? null;
}
