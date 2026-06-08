import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Radio } from "lucide-react";
import TournamentLivePanel from "@/components/cashier/TournamentLivePanel";

type ClubRow = { id: string; name: string };

export default function TrackerDashboard() {
  const { user, loading, isAdmin } = useAuth();
  const nav = useNavigate();
  const [clubs, setClubs] = useState<ClubRow[] | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/auth"); return; }
  }, [loading, user, nav]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: ids } = await supabase.rpc("tracker_club_ids", { _user_id: user.id });
      const idArr = (ids ?? []).map((r: any) => (typeof r === "string" ? r : r.tracker_club_ids ?? r));
      if (!idArr.length) { setClubs([]); return; }
      const { data: cs } = await supabase.from("clubs").select("id, name").in("id", idArr);
      setClubs((cs ?? []) as ClubRow[]);
    })();
  }, [user]);

  if (loading || !user) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (clubs === null) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (clubs.length === 0 && !isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 mx-auto text-warning" />
          <div className="text-lg font-bold">Bạn chưa được phân công CLB nào</div>
          <p className="text-sm text-muted-foreground">
            Liên hệ Super Admin để được gán quyền Tracker cho câu lạc bộ.
          </p>
        </Card>
      </div>
    );
  }

  const clubIds = clubs.map((c) => c.id);

  return (
    <div className="container mx-auto p-3 md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 text-emerald-400 rounded-md text-xs font-bold border border-emerald-500/30">
          <Radio className="w-3.5 h-3.5" /> LIVE TRACKER
        </div>
        <div className="text-sm text-muted-foreground">
          {clubs.length === 1 ? clubs[0].name : `${clubs.length} CLB`}
        </div>
      </div>
      <TournamentLivePanel clubIds={clubIds} clubs={clubs} />
    </div>
  );
}