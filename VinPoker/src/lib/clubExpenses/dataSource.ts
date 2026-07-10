import { FEATURES } from "@/lib/featureFlags";
import type { ClubExpenseSource } from "./types";

export function clubExpensesSource(): ClubExpenseSource {
  return FEATURES.clubExpenses ? "live" : "mock";
}

