import type { OpsSideEffectClass } from "@/ops/registry/opsModuleRegistry";

export type DelegatedServicesButtonManifestEntry = {
  actionId: "chip-ops.refresh";
  labelOrTestId: string;
  route: "/ops/chip-ops";
  expectedState: "ENABLED";
  expectedBackendCall: string;
  expectedDbInvariant: string;
  sideEffectClass: OpsSideEffectClass;
  disposition: "CLICKED_PASS";
};

export const DELEGATED_SERVICES_BUTTON_MANIFEST: readonly DelegatedServicesButtonManifestEntry[] = [{
  actionId: "chip-ops.refresh",
  labelOrTestId: '[data-ops-action="chip-ops.refresh"]',
  route: "/ops/chip-ops",
  expectedState: "ENABLED",
  expectedBackendCall: "fixed get_issued_chip_inventory RPC for a tournament proven inside the selected club",
  expectedDbInvariant: "No chip, bank, stack, issuance, color-up or bag row changes.",
  sideEffectClass: "READ",
  disposition: "CLICKED_PASS",
}] as const;
