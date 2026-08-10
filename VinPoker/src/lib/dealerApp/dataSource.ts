import { FEATURES } from "@/lib/featureFlags";
import type { DealerDataSource } from "@/types/dealerApp";

export function isDealerCustomerPreview(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("customer_preview") === "1";
}

/**
 * Live only when BOTH the app flag and the planner-layer flag are on. This makes
 * it impossible for production to query the dealer_shift_* tables before the
 * additive migration `20260827000000_dealer_shift_planner.sql` is applied live
 * (Phase 2, owner-gated). Otherwise the app runs entirely on in-memory mock data.
 */
export function dealerDataSource(): DealerDataSource {
  if (isDealerCustomerPreview()) return "mock";
  return FEATURES.dealerMobileApp && FEATURES.dealerShiftPlanner ? "live" : "mock";
}
