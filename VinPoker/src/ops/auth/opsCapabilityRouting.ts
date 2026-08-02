export type OpsEntryRouteInput = {
  hasOwnerAccess: boolean;
  hasFloorAccess: boolean;
  hasCashierAccess: boolean;
};

export type OpsEntryRoute =
  | "/ops/select-module"
  | "/ops/floor"
  | "/ops/cashier"
  | "access-denied";

export function resolveOpsEntry(input: OpsEntryRouteInput): OpsEntryRoute {
  if (!input.hasFloorAccess && !input.hasCashierAccess) return "access-denied";
  if (
    input.hasOwnerAccess ||
    (input.hasFloorAccess && input.hasCashierAccess)
  ) {
    return "/ops/select-module";
  }
  return input.hasFloorAccess ? "/ops/floor" : "/ops/cashier";
}
