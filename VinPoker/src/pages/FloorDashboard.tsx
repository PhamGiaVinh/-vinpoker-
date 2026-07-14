import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, LayoutGrid } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import TournamentLivePanel from "@/components/cashier/TournamentLivePanel";

/**
 * Floor — room management (table draw, prize structure, seating).
 * Reuses TournamentLivePanel in "floor" mode. Club scope + guard mirror the
 * former tournament_live section in CashierDashboard so data parity is preserved.
 */
export default function FloorDashboard() {
  const { t } = useTranslation();
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
  // Floor access = assigned floor operators (dealerClubIds), club owners/cashiers
  // (clubIds, so owners keep tournament control after it moved off Club Admin), or admins.
  if (dealerClubIds.length === 0 && clubIds.length === 0 && !isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 mx-auto text-warning" />
          <div className="text-lg font-bold">Bạn chưa được phân công CLB nào</div>
          <p className="text-sm text-muted-foreground">
            Liên hệ Super Admin để được gán quyền điều hành sàn (Floor) cho câu lạc bộ.
          </p>
        </Card>
      </div>
    );
  }

  const scopedIds = Array.from(new Set([...clubIds, ...dealerClubIds]));

  return (
    <div className="container mx-auto p-3 md:p-6">
      <BackButton to="/" label={t("nav.schedule")} className="mb-2" />
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/15 text-primary rounded-md text-xs font-bold border border-primary/30">
          <LayoutGrid className="w-3.5 h-3.5" /> FLOOR
        </div>
        <div className="text-sm text-muted-foreground">
          {clubs.length === 0 ? "Toàn quyền (Admin)" : clubs.length === 1 ? clubs[0].name : `${clubs.length} CLB`}
        </div>
      </div>
      <TournamentLivePanel mode="floor" clubIds={scopedIds} clubs={clubs} />
    </div>
  );
}
