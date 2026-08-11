/**
 * Production currently validates newly-created tournaments against the legacy
 * `registering` live status. Always send it explicitly instead of relying on
 * the database default, which has drifted to an invalid `upcoming` value.
 */
export const TOURNAMENT_CREATE_LIVE_STATUS = "registering" as const;

export function withTournamentCreateLiveStatus<T extends object>(
  payload: T,
): T & { live_status: typeof TOURNAMENT_CREATE_LIVE_STATUS } {
  return {
    ...payload,
    live_status: TOURNAMENT_CREATE_LIVE_STATUS,
  };
}
