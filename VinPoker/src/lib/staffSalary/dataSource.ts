import { FEATURES } from "@/lib/featureFlags";
import type { StaffSalarySource } from "./types";

export function staffSalarySource(): StaffSalarySource {
  return FEATURES.staffSalaryChot ? "live" : "mock";
}
