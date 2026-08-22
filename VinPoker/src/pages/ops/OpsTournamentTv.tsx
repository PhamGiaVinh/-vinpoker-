import { useEffect, type HTMLAttributes } from "react";
import { ChevronLeft } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { TvClockScreen } from "@/components/tv/TvClockScreen";
import { TvChrome } from "@/components/tv/TvChrome";
import { useTournamentTvDataCore } from "@/hooks/useTournamentTvDataCore";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";

function OpsTvStatusScreen({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-screen w-full flex-col items-center justify-center gap-[2vmin] px-[6vmin] text-center">
      <div className="text-[5vmin] font-bold text-foreground">{title}</div>
      {hint ? <div className="text-[2.4vmin] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/**
 * Full-screen Floor TV projection that stays inside the independent Ops
 * session. The public /tv/:tournamentId route remains unchanged for paired
 * displays and Player-app consumers.
 */
export default function OpsTournamentTv() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useOpsAuth();
  const live = useTournamentTvDataCore(id, {
    enabled: Boolean(id),
    userId: user?.id ?? null,
    authLoading,
  });
  const tournamentName = live.data?.tournamentName;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = tournamentName ? `${tournamentName} — Floor TV` : "VinPoker Floor TV";
    return () => {
      document.title = previousTitle;
    };
  }, [tournamentName]);

  const returnToScreens = id
    ? `/ops/floor/tournaments/${id}/screens${location.search}`
    : "/ops/floor";

  return (
    <TvChrome
      wrapperProps={{ "data-tournament-id": id } as HTMLAttributes<HTMLDivElement>}
      overlay={
        <button
          type="button"
          onClick={() => navigate(returnToScreens)}
          className="absolute left-[1.5vmin] top-[1.5vmin] z-20 inline-flex min-h-11 items-center gap-2 rounded-full border border-border/70 bg-background/85 px-4 text-[max(12px,1.8vmin)] font-semibold text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
          Quay lại Floor
        </button>
      }
    >
      {live.state === "ready" && live.data ? (
        <TvClockScreen data={live.data} />
      ) : live.state === "loading" ? (
        <OpsTvStatusScreen title="Đang tải đồng hồ giải" />
      ) : live.state === "auth_required" ? (
        <OpsTvStatusScreen title="Phiên Ops đã hết hạn" hint="Đăng nhập lại Ops để xem đồng hồ giải." />
      ) : live.state === "not_found" ? (
        <OpsTvStatusScreen title="Không tìm thấy giải" />
      ) : (
        <OpsTvStatusScreen title="Không tải được đồng hồ giải" hint="Vui lòng quay lại Floor và thử lại." />
      )}
    </TvChrome>
  );
}
