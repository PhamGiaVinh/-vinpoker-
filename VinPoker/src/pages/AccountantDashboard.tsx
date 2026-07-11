import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { RouteLoader } from "@/components/RouteLoader";
import StaffSalaryChot from "./StaffSalaryChot";

/**
 * Accountant workspace (/accountant) — a dedicated, role-gated area for the club accountant,
 * parallel to the cashier / tracker / floor dashboards. Only accountants (club_accountants),
 * club owners, and admins reach it; everyone else is redirected. The work surface is the salary
 * chốt/duyệt flow (StaffSalaryChot), which further filters clubs + enforces authz server-side.
 */
export default function AccountantDashboard() {
  const { loading, user, isAdmin, isClubOwner, isAccountant } = useAuth();

  if (loading) return <RouteLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!(isAccountant || isClubOwner || isAdmin)) return <Navigate to="/" replace />;

  return <StaffSalaryChot />;
}
