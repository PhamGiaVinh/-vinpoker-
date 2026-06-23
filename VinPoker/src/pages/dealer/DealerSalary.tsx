import { Navigate } from "react-router-dom";
import { FEATURES } from "@/lib/featureFlags";
import { DealerSalaryScreen } from "@/components/dealer-app/salary/DealerSalaryScreen";

export default function DealerSalary() {
  // Route-level flag gate: when dealerSelfSalary is OFF the salary screen must NOT
  // render even via direct navigation to /dealer/salary — redirect to dealer home.
  // (Hiding the nav tab alone is not enough.)
  if (!FEATURES.dealerSelfSalary) return <Navigate to="/dealer" replace />;
  return <DealerSalaryScreen />;
}
