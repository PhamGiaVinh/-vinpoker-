import { FEATURES } from "@/lib/featureFlags";

type IntelligenceEnvironment = { readonly dev: boolean; readonly e2eFlag: string | undefined };

/** Production cannot be enabled by a VITE E2E value: DEV must be true as well. */
export function isOpsIntelligenceCommandCenterEnabled(
  featureEnabled = FEATURES.opsIntelligenceCommandCenterV1,
  environment: IntelligenceEnvironment = { dev: import.meta.env.DEV, e2eFlag: import.meta.env.VITE_E2E_OPS_INTELLIGENCE },
): boolean {
  return featureEnabled || (environment.dev && environment.e2eFlag === "true");
}

export function shouldReadTrackerAlerts(trackerVoiceInputEnabled: boolean, runningTournamentIds: readonly string[]): boolean {
  return trackerVoiceInputEnabled && runningTournamentIds.length > 0;
}
