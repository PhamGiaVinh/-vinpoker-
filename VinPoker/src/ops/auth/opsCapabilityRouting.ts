export type OpsEntryRouteInput = {
  availableModuleRoutes: readonly string[];
};

export type OpsEntryRoute = string | "access-denied";

export function resolveOpsEntry(input: OpsEntryRouteInput): OpsEntryRoute {
  if (input.availableModuleRoutes.length === 0) return "access-denied";
  if (input.availableModuleRoutes.length > 1) return "/ops/select-module";
  return input.availableModuleRoutes[0];
}
