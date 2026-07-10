import { Navigate } from "react-router-dom";
import { FEATURES } from "@/lib/featureFlags";
import { StaffSalaryScreen } from "@/components/staff-app/salary/StaffSalaryScreen";

export default function StaffSalary() {
  if (!FEATURES.staffSelfSalary) return <Navigate to="/staff" replace />;
  return <StaffSalaryScreen />;
}

