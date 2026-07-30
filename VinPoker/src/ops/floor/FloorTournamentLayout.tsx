import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Outlet, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  TournamentOpsProvider,
  useTournamentOps,
} from "@/ops/floor/TournamentOpsProvider";
import { TournamentContextRail } from "@/ops/floor/TournamentContextRail";

function FloorTournamentWorkspace() {
  const { tournament, loading, error, refresh, refreshedAt } = useTournamentOps();

  if (loading && !tournament) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center text-[#91a49b]">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-300" />
        Đang tải không gian giải…
      </div>
    );
  }
  if (error || !tournament) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-rose-300/20 bg-rose-300/5 p-6 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-rose-300" />
        <h1 className="mt-3 text-lg font-semibold text-white">Không mở được không gian giải</h1>
        <p className="mt-1 text-sm text-rose-100/80">{error ?? "Không tìm thấy giải đấu."}</p>
        <Button type="button" variant="outline" className="mt-5 min-h-11" onClick={refresh}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Thử lại
        </Button>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-5 md:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]">
      <TournamentContextRail tournament={tournament} />
      <section className="min-w-0 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="mb-3 hidden items-center justify-end gap-2 text-xs text-[#789084] md:flex">
          {refreshedAt && <span>Cập nhật {new Date(refreshedAt).toLocaleTimeString("vi-VN")}</span>}
          <button
            type="button"
            onClick={refresh}
            className="grid min-h-11 min-w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-[#b8c6bf]"
            aria-label="Làm mới không gian giải"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <Outlet />
      </section>
    </div>
  );
}

export default function FloorTournamentLayout() {
  const { id } = useParams();
  if (!id) return null;
  return (
    <TournamentOpsProvider tournamentId={id}>
      <FloorTournamentWorkspace />
    </TournamentOpsProvider>
  );
}
