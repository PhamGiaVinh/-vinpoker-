import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Calculator, Table2, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import { RouteLoader } from "@/components/RouteLoader";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { staffSalarySource } from "@/lib/staffSalary/dataSource";
import { useSalaryClubs } from "@/hooks/staffSalary/useStaffSalary";
import { useAccountantCapabilities } from "@/hooks/accountant/useAccountantCapabilities";
import { PendingDbNotice } from "@/components/accountant/PendingDbNotice";
import DealerPayrollTab from "@/components/cashier/DealerPayrollTab";
import StaffSalaryChot from "./StaffSalaryChot";

/**
 * Accountant workspace (/accountant) — the dedicated, role-gated "Kế toán" area, parallel
 * to the cashier / tracker / floor dashboards. Only accountants (club_accountants), club
 * owners, and admins reach it; everyone else is redirected.
 *
 * With FEATURES.accountantWorkspace OFF this renders exactly the pre-workspace page
 * (StaffSalaryChot) — a clean kill-switch. With it ON, a tabbed shell: tab availability is
 * decided by get_accountant_capabilities (per-domain server authz probe), NEVER inferred
 * from empty data. Every write keeps its server-side gate; the UI is presentation only.
 */
export default function AccountantDashboard() {
  const { loading, user, isAdmin, isClubOwner, isAccountant } = useAuth();
  const source = staffSalarySource();
  const gateOk = !loading && !!user && (isAccountant || isClubOwner || isAdmin);

  const clubsQuery = useSalaryClubs(source, gateOk && FEATURES.accountantWorkspace);
  const clubs = useMemo(() => clubsQuery.data ?? [], [clubsQuery.data]);
  const [clubId, setClubId] = useState("");
  const activeClubId = clubId || clubs[0]?.id || null;
  const activeClub = clubs.find((c) => c.id === activeClubId) ?? null;
  const { caps } = useAccountantCapabilities(FEATURES.accountantWorkspace ? activeClubId : null);

  useEffect(() => {
    if (!clubId && clubs[0]?.id) setClubId(clubs[0].id);
  }, [clubId, clubs]);

  if (loading) return <RouteLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!(isAccountant || isClubOwner || isAdmin)) return <Navigate to="/" replace />;

  // Kill-switch: exact pre-workspace behavior.
  if (!FEATURES.accountantWorkspace) return <StaffSalaryChot />;

  // Owner/admin already pass the pre-migration authz for dealer payroll; accountant-only
  // users need migration 20261236000000 (probe says so). Approve/lock stays owner/admin.
  const hasOwnerAdmin = isAdmin || clubs.some((c) => c.role === "owner" || c.role === "admin");
  const dealerAvailable = hasOwnerAdmin || (caps.state === "ok" && caps.payroll);
  const hideApprovalActions = !hasOwnerAdmin;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl text-primary inline-flex items-center gap-2">
              <Calculator className="w-6 h-6" />
              Kế toán
            </h1>
            <Badge variant="outline" className="text-[10px]">
              {activeClub?.role === "accountant" ? "KẾ TOÁN CLB" : activeClub?.role === "owner" ? "CHỦ CLB" : "ADMIN"}
            </Badge>
          </div>
          <p className="text-[12px] text-muted-foreground max-w-2xl">
            Bàn làm việc kế toán: bảng lương, nhân viên, chi phí và báo cáo. Kế toán chốt + gửi — chủ CLB duyệt.
          </p>
        </div>
        {clubs.length > 1 && (
          <div className="w-full sm:w-64">
            <Select value={activeClubId ?? ""} onValueChange={setClubId}>
              <SelectTrigger className="bg-background border-border">
                <SelectValue placeholder="Chọn CLB" />
              </SelectTrigger>
              <SelectContent>
                {clubs.map((club) => (
                  <SelectItem key={club.id} value={club.id}>
                    {club.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </header>

      <Tabs defaultValue="salary" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="salary" className="gap-1.5">
            <Wallet className="w-4 h-4" />
            Bảng lương NV
          </TabsTrigger>
          <TabsTrigger value="dealer" className="gap-1.5">
            <Table2 className="w-4 h-4" />
            Lương dealer
          </TabsTrigger>
        </TabsList>

        <TabsContent value="salary">
          <StaffSalaryChot embedded />
        </TabsContent>

        <TabsContent value="dealer">
          {dealerAvailable ? (
            <DealerPayrollTab
              clubIds={clubs.map((c) => c.id)}
              clubs={clubs.map((c) => ({ id: c.id, name: c.name }))}
              hideApprovalActions={hideApprovalActions}
            />
          ) : (
            <PendingDbNotice state={caps.state === "ok" ? "forbidden" : caps.state} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
