import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";
import { TournamentLiveView } from "@/components/cashier/tournament-live/TournamentLiveView";
import { LiveHub } from "@/components/cashier/tournament-live/viewer-hub/LiveHub";

const TournamentLiveTracker = () => {
  const { tournamentId } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tournament, setTournament] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Deep-link: ?hand=N opens that completed hand in the viewer's replay.
  const deepHandRaw = Number(searchParams.get("hand"));
  const deepHandNumber = Number.isFinite(deepHandRaw) && deepHandRaw > 0 ? deepHandRaw : null;

  const shareUrl = useCallback(
    async (url: string, ok: string) => {
      const title = tournament?.name ? `Live Tracker — ${tournament.name}` : "VinPoker Live Tracker";
      try {
        if (navigator.share) {
          await navigator.share({ title, url });
          return;
        }
        await navigator.clipboard.writeText(url);
        toast.success(ok);
      } catch (e: any) {
        if (e?.name === "AbortError") return; // user cancelled the native sheet
        try {
          await navigator.clipboard.writeText(url);
          toast.success(ok);
        } catch {
          toast.error("Không sao chép được link — hãy copy từ thanh địa chỉ");
        }
      }
    },
    [tournament?.name],
  );

  const handleShare = useCallback(() => shareUrl(window.location.href, "Đã sao chép link live tracker"), [shareUrl]);

  // Hand-feed "Chia sẻ" → a link to that specific hand (?hand=N).
  const handleShareHand = useCallback(
    (n: number) => {
      const u = new URL(window.location.href);
      u.searchParams.set("hand", String(n));
      return shareUrl(u.toString(), `Đã sao chép link ván #${n}`);
    },
    [shareUrl],
  );

  // Hand-feed "Xem ván" → set ?hand=N (drives the viewer into replay) + scroll up to
  // the featured felt.
  const handleViewHand = useCallback(
    (n: number) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set("hand", String(n));
          return p;
        },
        { replace: false },
      );
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [setSearchParams],
  );

  // Leaving the felt (Quay lại) → drop ?hand so a refresh stays on the tabs.
  const handleCloseHand = useCallback(() => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("hand");
        return p;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  useEffect(() => {
    if (!tournamentId) return;
    (async () => {
      const { data } = await supabase
        .from("tournaments")
        .select("id, name, status, prize_pool, players_remaining, current_level, buy_in, guarantee_amount, starting_stack, club:clubs(id, name)")
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
        <BackButton />
      </div>

      <LiveHub
        tournamentId={tournamentId!}
        title={tournament.name}
        clubName={tournament.club?.name}
        clubId={tournament.club?.id}
        prizePool={tournament.prize_pool}
        playersRemaining={tournament.players_remaining}
        currentLevel={tournament.current_level}
        guarantee={tournament.guarantee_amount}
        buyIn={tournament.buy_in}
        startingStack={tournament.starting_stack}
        onShare={handleShare}
        initialReplayHandNumber={deepHandNumber}
        onViewHand={handleViewHand}
        onShareHand={handleShareHand}
        onCloseHand={handleCloseHand}
      >
        <TournamentLiveView tournamentId={tournamentId!} />
      </LiveHub>
    </div>
  );
};

export default TournamentLiveTracker;
