import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Table2, Calculator, CalendarRange } from "lucide-react";
import SwingPanel from "@/components/cashier/DealerSwingTab";
import DealerPayrollTab from "@/components/cashier/DealerPayrollTab";
import ShiftPlannerTab from "@/components/cashier/ShiftPlannerTab";
import { FEATURES } from "@/lib/featureFlags";

/**
 * Dealer Swing — Dealer Swing + Bảng lương (payroll) grouped in one destination.
 * Reuses DealerSwingTab and DealerPayrollTab as-is; club scope + guard mirror the
 * former swing/payroll sections in CashierDashboard so behaviour is unchanged.
 */
export default function DealerSwingDashboard() {
  const { user, loading, isAdmin } = useAuth();
  const nav = useNavigate();
  const { clubs, clubIds, dealerClubIds } = useOperatorClubs();

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/auth"); return; }
  }, [loading, user, nav]);

  if (loading || !user) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (clubs === null) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (dealerClubIds.length === 0 && !isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 mx-auto text-warning" />
          <div className="text-lg font-bold">Bạn chưa được phân công CLB nào</div>
          <p className="text-sm text-muted-foreground">
            Liên hệ Super Admin để được gán quyền điều hành dealer (Dealer Swing) cho câu lạc bộ.
          </p>
        </Card>
      </div>
    );
  }

  const scopedIds = dealerClubIds.length > 0 ? dealerClubIds : clubIds;

  return (
    <div className="container mx-auto p-3 md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/15 text-primary rounded-md text-xs font-bold border border-primary/30">
          <Table2 className="w-3.5 h-3.5" /> DEALER SWING
        </div>
        <div className="text-sm text-muted-foreground">
          {clubs.length === 0 ? "Toàn quyền (Admin)" : clubs.length === 1 ? clubs[0].name : `${clubs.length} CLB`}
        </div>
      </div>

      <Tabs defaultValue="swing" className="w-full">
        <TabsList className={`grid w-full ${FEATURES.dealerShiftPlanner ? "grid-cols-3" : "grid-cols-2"} h-auto`}>
          <TabsTrigger value="swing"><Table2 className="w-4 h-4 mr-1" /> Dealer Swing</TabsTrigger>
          <TabsTrigger value="payroll"><Calculator className="w-4 h-4 mr-1" /> Bảng lương</TabsTrigger>
          {FEATURES.dealerShiftPlanner && (
            <TabsTrigger value="shift_planner"><CalendarRange className="w-4 h-4 mr-1" /> Xếp lịch dealer</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="swing" className="mt-4">
          <SwingPanel clubIds={scopedIds} clubs={clubs} />
        </TabsContent>
        <TabsContent value="payroll" className="mt-4">
          <DealerPayrollTab clubIds={scopedIds} clubs={clubs} />
        </TabsContent>
        {FEATURES.dealerShiftPlanner && (
          <TabsContent value="shift_planner" className="mt-4">
            <ShiftPlannerTab clubIds={scopedIds} clubs={clubs} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
