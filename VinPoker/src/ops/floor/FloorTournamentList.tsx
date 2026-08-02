import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronRight, Loader2, RefreshCw, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTournaments } from "@/hooks/useTournaments";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import type { Tournament } from "@/types/tournament";

const statusLabel: Record<string, string> = {
  upcoming: "Sắp diễn ra",
  registering: "Đang đăng ký",
  drawing: "Đang xếp bàn",
  live: "Đang chạy",
  break: "Giải lao",
  final_table: "Final table",
  completed: "Đã kết thúc",
  cancelled: "Đã hủy",
};

export default function FloorTournamentList() {
  const { floorClubIds, clubs, metadataError } = useOpsCapabilities();
  const [clubId, setClubId] = useState<string | null>(null);

  useEffect(() => {
    if (floorClubIds.length === 0) {
      setClubId(null);
      return;
    }
    setClubId((current) => current && floorClubIds.includes(current) ? current : floorClubIds[0]);
  }, [floorClubIds]);

  const { data, isLoading, isFetching, refetch, error } = useTournaments(clubId ?? undefined);
  const tournaments = useMemo(
    () => ((data ?? []) as unknown as Tournament[])
      .filter((tournament) => tournament.club_id === clubId)
      .sort((a, b) => {
        const order = ["live", "break", "final_table", "drawing", "registering", "upcoming", "completed", "cancelled"];
        const rank = (status: string) => {
          const index = order.indexOf(status);
          return index === -1 ? order.length : index;
        };
        return rank(a.status) - rank(b.status);
      }),
    [clubId, data],
  );

  return (
    <section className="space-y-5" aria-labelledby="floor-tournaments-heading">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Floor</p>
          <h1 id="floor-tournaments-heading" className="mt-1 text-2xl font-semibold text-white sm:text-3xl">
            Danh sách giải đấu
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[#91a49b]">
            Chọn một giải để vào đúng không gian Bàn, Người chơi, Đồng hồ, Trả thưởng và TV.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 border-white/10 bg-white/5 text-white"
          disabled={!clubId || isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Làm mới
        </Button>
      </header>

      {floorClubIds.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Chọn CLB">
          {floorClubIds.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setClubId(id)}
              className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium ${
                clubId === id
                  ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-200"
                  : "border-white/10 bg-white/5 text-[#b6c4bd]"
              }`}
            >
              {clubs.find((club) => club.id === id)?.name ?? `CLB ${id.slice(0, 6)}`}
            </button>
          ))}
        </div>
      )}
      {metadataError && <p className="text-sm text-amber-300">{metadataError}</p>}

      {isLoading ? (
        <div className="flex min-h-56 items-center justify-center text-[#91a49b]">
          <Loader2 className="mr-3 h-5 w-5 animate-spin text-emerald-300" />
          Đang tải giải đấu…
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-rose-300/20 bg-rose-300/5 p-6 text-sm text-rose-200">
          Không tải được danh sách giải. Hãy kiểm tra kết nối rồi thử lại.
        </div>
      ) : tournaments.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/12 bg-white/[0.025] p-8 text-center">
          <Trophy className="mx-auto h-8 w-8 text-[#789084]" />
          <h2 className="mt-3 font-semibold text-white">Chưa có giải trong phạm vi này</h2>
          <p className="mt-1 text-sm text-[#91a49b]">Floor chỉ thấy các giải thuộc CLB đã được cấp quyền.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tournaments.map((tournament) => (
            <Link
              key={tournament.id}
              to={`/ops/floor/tournaments/${tournament.id}/tables`}
              className="group flex min-h-36 flex-col justify-between rounded-3xl border border-white/10 bg-white/[0.035] p-5 transition hover:border-emerald-300/30 hover:bg-emerald-300/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-white">{tournament.name}</h2>
                  <p className="mt-1 flex items-center gap-2 text-xs text-[#91a49b]">
                    <CalendarDays className="h-4 w-4" />
                    {statusLabel[tournament.status] ?? tournament.status}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-[#789084] transition group-hover:translate-x-0.5 group-hover:text-emerald-300" />
              </div>
              <div className="mt-5 flex items-center justify-between text-sm">
                <span className="text-[#91a49b]">Còn lại</span>
                <span className="font-mono font-semibold text-emerald-200">
                  {tournament.players_remaining ?? "—"} người
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
