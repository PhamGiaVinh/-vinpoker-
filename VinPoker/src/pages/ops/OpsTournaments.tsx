import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, LogIn, MonitorUp, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import CloseReportDialog from "@/components/cashier/tournament-live/CloseReportDialog";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import { useTournaments } from "@/hooks/useTournaments";
import { FEATURES } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";
import type { TournamentWithTables } from "@/types/tournament";

type Filter = "live" | "today" | "all";
type OperatorTournament = TournamentWithTables & {
  start_time: string | null;
  buy_in: number;
  current_players: number | null;
};

const LIVE_STATUSES = new Set(["live", "break", "final_table"]);
const UPCOMING_STATUSES = new Set(["upcoming", "registering", "drawing"]);

function statusView(status: string) {
  if (status === "break") return { label: "Giải lao", className: "bg-amber-400/12 text-amber-300" };
  if (status === "live" || status === "final_table") return { label: "Đang chơi", className: "bg-emerald-400/12 text-emerald-300" };
  if (UPCOMING_STATUSES.has(status)) return { label: "Sắp diễn ra", className: "bg-sky-400/12 text-sky-300" };
  if (status === "cancelled") return { label: "Đã huỷ", className: "bg-rose-400/12 text-rose-300" };
  return { label: "Đã kết thúc", className: "bg-white/6 text-[#9b8e97]" };
}

function isToday(value: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

/** Real tournament list. Mutations are limited to the audited cockpit and close report. */
export default function OpsTournaments() {
  const navigate = useNavigate();
  const { isAdmin, isClubOwner, isCashier } = useAuth();
  const { loading: clubsLoading, user, clubs, clubIds, error: clubsError } = useOperatorClubs();
  const activeClub = clubIds[0];
  const tournamentsQ = useTournaments(activeClub);
  const [filter, setFilter] = useState<Filter>("live");
  const [closeTarget, setCloseTarget] = useState<OperatorTournament | null>(null);

  const tournaments = useMemo(() => (tournamentsQ.data ?? []) as OperatorTournament[], [tournamentsQ.data]);
  const rows = useMemo(() => {
    if (filter === "live") return tournaments.filter((tournament) => LIVE_STATUSES.has(tournament.status));
    if (filter === "today") return tournaments.filter((tournament) => isToday(tournament.start_time));
    return tournaments;
  }, [filter, tournaments]);
  const canClose = FEATURES.closeReport && (isAdmin || isClubOwner || isCashier);

  if (clubsLoading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Kiểm tra đăng nhập và phạm vi CLB." />;
  if (!user) return <Guard icon={<LogIn className="h-8 w-8 text-[#c9a86a]" />} title="Cần đăng nhập" sub="Đăng nhập để xem giải đấu của câu lạc bộ." />;
  if (clubsError) return <Guard icon={<Trophy className="h-8 w-8 text-rose-300" />} title="Không tải được phạm vi CLB" sub={clubsError} />;
  if (!activeClub) return <Guard icon={<Trophy className="h-8 w-8 text-amber-300" />} title="Chưa có câu lạc bộ" sub="Chưa được phân công CLB nào để xem giải." />;
  if (tournamentsQ.isLoading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải giải…" sub="Lấy dữ liệu giải đấu thật." />;
  if (tournamentsQ.error) return <Guard icon={<Trophy className="h-8 w-8 text-rose-300" />} title="Không tải được giải" sub="Không dùng dữ liệu mẫu thay thế. Vui lòng thử lại." />;

  const clubName = clubs?.find((club) => club.id === activeClub)?.name ?? "CLB";
  const filters: Array<{ key: Filter; label: string }> = [
    { key: "live", label: "Đang chơi" },
    { key: "today", label: "Hôm nay" },
    { key: "all", label: `Tất cả (${tournaments.length})` },
  ];

  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Giải đấu</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">{clubName} · dữ liệu trực tiếp</p>
      </header>

      <div className="flex gap-1.5 px-1">
        {filters.map((item) => (
          <button key={item.key} onClick={() => setFilter(item.key)} className={cn("ios-press-sm rounded-full px-3 py-1.5 text-[13px] font-medium", filter === item.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>{item.label}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="ios-card py-10 text-center text-[14px] text-[#9b8e97]">{filter === "live" ? "Không có giải nào đang chơi." : "Không có giải phù hợp."}</div>
      ) : (
        <div className="space-y-2">
          {rows.map((tournament) => {
            const status = statusView(tournament.status);
            const time = tournament.start_time
              ? new Date(tournament.start_time).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
              : "Chưa có giờ";
            return (
              <div key={tournament.id} className="ios-card overflow-hidden">
                <button onClick={() => navigate(`/ops/tournaments/${tournament.id}`)} className="ios-press-sm flex w-full items-center gap-3 px-4 py-3.5 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold text-[#f2ece6]">{tournament.name}</span>
                    <span className="mt-0.5 block font-mono text-[12px] text-[#9b8e97]">{time} · buy-in {tournament.buy_in.toLocaleString("vi-VN")}</span>
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", status.className)}>{status.label}</span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#5f545c]" />
                </button>
                {canClose && LIVE_STATUSES.has(tournament.status) ? (
                  <div className="border-t border-white/6 px-4 py-2.5 text-right">
                    <button onClick={() => setCloseTarget(tournament)} className="ios-press-sm rounded-xl bg-amber-400/12 px-3 py-2 text-[13px] font-semibold text-amber-300">Xem báo cáo & chốt giải</button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <section className="ios-card flex items-start gap-3 px-4 py-3.5">
        <MonitorUp className="mt-0.5 h-5 w-5 shrink-0 text-[#c9a86a]" />
        <div>
          <div className="text-[15px] font-semibold text-[#f2ece6]">Tạo, sửa hoặc xoá giải: dùng máy tính</div>
          <p className="mt-0.5 text-[12px] leading-5 text-[#9b8e97]">Mobile chỉ mở các thao tác Floor đã nối thật; không hiển thị form hay số liệu mẫu.</p>
        </div>
      </section>

      {closeTarget ? (
        <CloseReportDialog
          open
          onOpenChange={(open) => { if (!open) setCloseTarget(null); }}
          tournamentId={closeTarget.id}
          tournamentName={closeTarget.name}
          onClosed={() => { setCloseTarget(null); void tournamentsQ.refetch(); }}
        />
      ) : null}
    </div>
  );
}

function Guard({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  const navigate = useNavigate();
  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]"><ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính</button>
        <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Giải đấu</h1>
      </header>
      <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
        {icon}
        <div className="mt-1 text-[16px] font-semibold text-[#f2ece6]">{title}</div>
        <div className="max-w-[260px] text-[13px] text-[#9b8e97]">{sub}</div>
      </div>
    </div>
  );
}
