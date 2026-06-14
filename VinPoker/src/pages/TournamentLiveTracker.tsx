import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TournamentLiveView } from "@/components/cashier/tournament-live/TournamentLiveView";
import { LiveHub } from "@/components/cashier/tournament-live/viewer-hub/LiveHub";

const TournamentLiveTracker = () => {
  const { tournamentId } = useParams();
  const nav = useNavigate();
  const [tournament, setTournament] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    const title = tournament?.name ? `Live Tracker — ${tournament.name}` : "VinPoker Live Tracker";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Đã sao chép link live tracker");
    } catch (e: any) {
      // User cancelling the native share sheet is not an error worth surfacing.
      if (e?.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Đã sao chép link live tracker");
      } catch {
        toast.error("Không sao chép được link — hãy copy từ thanh địa chỉ");
      }
    }
  }, [tournament?.name]);

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

      <LiveHub
        tournamentId={tournamentId!}
        title={tournament.name}
        clubName={tournament.club?.name}
        clubId={tournament.club?.id}
        onShare={handleShare}
      >
        <TournamentLiveView tournamentId={tournamentId!} />
      </LiveHub>
    </div>
  );
};

export default TournamentLiveTracker;
