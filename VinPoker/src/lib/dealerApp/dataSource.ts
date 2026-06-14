import { FEATURES } from "@/lib/featureFlags";
import type { DealerDataSource } from "@/types/dealerApp";

/**
 * Live only when BOTH the app flag and the planner-layer flag are on. This makes
 * it impossible for production to query the dealer_shift_* tables before the
 * additive migration `20260827000000_dealer_shift_planner.sql` is applied live
 * (Phase 2, owner-gated). Otherwise the app runs entirely on in-memory mock data.
 */
export function dealerDataSource(): DealerDataSource {
  return FEATURES.dealerMobileApp && FEATURES.dealerShiftPlanner ? "live" : "mock";
}
