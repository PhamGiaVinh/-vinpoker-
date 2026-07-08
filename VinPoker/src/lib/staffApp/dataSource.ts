import { FEATURES } from "@/lib/featureFlags";
import type { StaffDataSource } from "@/types/staffApp";

export function staffDataSource(): StaffDataSource {
  return FEATURES.staffApp ? "live" : "mock";
}

