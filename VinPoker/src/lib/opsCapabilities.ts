export type MobileOpsCapabilities = {
  isAdmin: boolean;
  isClubAdmin: boolean;
  isClubOwner: boolean;
  isCashier: boolean;
  isTracker: boolean;
  isFloor: boolean;
};

/**
 * UI affordance only. Data authority remains enforced by RLS/RPC checks for the
 * selected club. Keeping this policy in one pure function makes route gating
 * explicit and testable.
 */
export function canAccessMobileOps(capabilities: MobileOpsCapabilities): boolean {
  return Object.values(capabilities).some(Boolean);
}

export function canAccessMobileCashier(
  capabilities: Pick<MobileOpsCapabilities, "isAdmin" | "isClubOwner" | "isCashier">,
): boolean {
  return capabilities.isAdmin || capabilities.isClubOwner || capabilities.isCashier;
}
