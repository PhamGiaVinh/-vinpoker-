import { FEATURES } from "@/lib/featureFlags";

export function isOpsQuantDashboardQ1Enabled(sourceFlag: boolean = FEATURES.opsQuantDashboardQ1): boolean {
  return sourceFlag;
}
