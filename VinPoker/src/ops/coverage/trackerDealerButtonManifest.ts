import type { OpsSideEffectClass } from "@/ops/registry/opsModuleRegistry";

export type TrackerDealerButtonManifestEntry = {
  actionId: "tracker.refresh" | "dealer-control.refresh";
  labelOrTestId: string;
  route: "/ops/tracker" | "/ops/dealer-swing";
  expectedState: "ENABLED";
  expectedBackendCall: string;
  expectedDbInvariant: string;
  sideEffectClass: OpsSideEffectClass;
  disposition: "CLICKED_PASS";
};

export const TRACKER_DEALER_BUTTON_MANIFEST: readonly TrackerDealerButtonManifestEntry[] = [
  {
    actionId: "tracker.refresh",
    labelOrTestId: '[data-ops-action="tracker.refresh"]',
    route: "/ops/tracker",
    expectedState: "ENABLED",
    expectedBackendCall: "tracker read adapter SELECTs for the exact selected club",
    expectedDbInvariant: "No row is inserted, updated or deleted.",
    sideEffectClass: "READ",
    disposition: "CLICKED_PASS",
  },
  {
    actionId: "dealer-control.refresh",
    labelOrTestId: '[data-ops-action="dealer-control.refresh"]',
    route: "/ops/dealer-swing",
    expectedState: "ENABLED",
    expectedBackendCall: "dealer-control read adapter SELECTs for the exact selected club",
    expectedDbInvariant: "No row is inserted, updated or deleted; payroll is not read.",
    sideEffectClass: "READ",
    disposition: "CLICKED_PASS",
  },
] as const;
