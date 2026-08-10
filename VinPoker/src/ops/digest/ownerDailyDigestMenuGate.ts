export function canShowOwnerDailyDigestMenu(input: {
  isAdmin: boolean;
  isClubOwner: boolean;
  featureEnabled: boolean;
}): boolean {
  return input.isAdmin || (input.isClubOwner && input.featureEnabled);
}
