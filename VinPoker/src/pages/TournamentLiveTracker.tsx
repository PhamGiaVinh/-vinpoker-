import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Radio } from "lucide-react";
import { TournamentLiveView } from "@/components/cashier/tournament-live/TournamentLiveView";

const TournamentLiveTracker = () => {
  const { tournamentId } = useParams();
  const nav = useNavigate();
  const [tournament, setTournament] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId) return;
    (async () => {
      const { data } = await supabase
        .from("tournaments")
        .select("id, name, status, club:clubs(id, name)")
        .eq("id", tournamentId)
        .maybeSingle();
      setTournament(data);
      setLoading(false);
    })();
  }, [tournamentId]);

  useEffect(() => {
    if (!tournamentId) return;
    const channel = supabase
      .channel(`live-tracker:${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` },
        (payload) => setTournament((prev: any) => (prev ? { ...prev, ...payload.new } : prev))
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tournamentId]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-muted-foreground">Không tìm thấy giải đấu</p>
        <Button variant="outline" onClick={() => nav("/")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Quay lại
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => nav(-1)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Quay lại
        </button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 text-emerald-400 rounded-md text-xs font-bold border border-emerald-500/30 animate-pulse">
            <Radio className="w-3.5 h-3.5" /> LIVE
          </div>
          <div>
            <h1 className="font-display font-bold text-lg leading-tight">{tournament.name}</h1>
            {tournament.club?.name && (
              <Link
                to={`/club/${tournament.club.id}`}
                className="text-xs text-muted-foreground hover:text-emerald-400 transition-colors"
              >
                {tournament.club.name}
              </Link>
            )}
          </div>
        </div>
      </div>

      <TournamentLiveView tournamentId={tournamentId!} />
    </div>
  );
};

export default TournamentLiveTracker;
