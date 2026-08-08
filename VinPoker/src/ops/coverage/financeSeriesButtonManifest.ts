import type { OpsSideEffectClass } from "@/ops/registry/opsModuleRegistry";

export type FinanceSeriesButtonManifestEntry = {
  actionId: "finance.refresh" | "series.refresh";
  labelOrTestId: string;
  route: "/ops/finance" | "/ops/series";
  expectedState: "ENABLED";
  expectedBackendCall: string;
  expectedDbInvariant: string;
  sideEffectClass: OpsSideEffectClass;
  disposition: "CLICKED_PASS";
};

export const FINANCE_SERIES_BUTTON_MANIFEST: readonly FinanceSeriesButtonManifestEntry[] = [
  {
    actionId: "finance.refresh",
    labelOrTestId: '[data-ops-action="finance.refresh"]',
    route: "/ops/finance",
    expectedState: "ENABLED",
    expectedBackendCall: "get_club_finance_summary for the exact selected owner club and fixed current-month range",
    expectedDbInvariant: "No finance, payment, payroll, expense or payout row changes.",
    sideEffectClass: "READ",
    disposition: "CLICKED_PASS",
  },
  {
    actionId: "series.refresh",
    labelOrTestId: '[data-ops-action="series.refresh"]',
    route: "/ops/series",
    expectedState: "ENABLED",
    expectedBackendCall: "get_club_series_events for the exact selected owner club",
    expectedDbInvariant: "No Series event, capture, plan or browser library state changes.",
    sideEffectClass: "READ",
    disposition: "CLICKED_PASS",
  },
] as const;
