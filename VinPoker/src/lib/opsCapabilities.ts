export type MobileOpsCapabilities = {
  isAdmin: boolean;
  isClubAdmin: boolean;
  isClubOwner: boolean;
  isCashier: boolean;
  isTracker: boolean;
  isFloor: boolean;
};

/** UI gate only. Database and Edge authorization remain authoritative. */
export function canAccessMobileOps(capabilities: MobileOpsCapabilities): boolean {
  return Object.values(capabilities).some(Boolean);
}

export function canAccessMobileCashier(
  capabilities: Pick<MobileOpsCapabilities, "isAdmin" | "isClubOwner" | "isCashier">,
): boolean {
  return capabilities.isAdmin || capabilities.isClubOwner || capabilities.isCashier;
}
