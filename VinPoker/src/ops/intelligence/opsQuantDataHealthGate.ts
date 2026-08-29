import { FEATURES } from "@/lib/featureFlags";

export function isOpsQuantDataHealthQ0Enabled(
  sourceFlag: boolean = FEATURES.opsQuantDataHealthQ0,
  environment = { dev: import.meta.env.DEV, e2eFlag: import.meta.env.VITE_E2E_OPS_QUANT_Q0 },
): boolean {
  return sourceFlag || (environment.dev && environment.e2eFlag === "true");
}
