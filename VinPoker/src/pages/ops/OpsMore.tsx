import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes,
  ChevronRight,
  Coins,
  LayoutGrid,
  Loader2,
  Megaphone,
  Repeat,
  Scale,
  Search,
  Sparkles,
  Trophy,
  Users,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RoleLockedAction } from "@/components/ops/shared/RoleLockedAction";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import { useTournaments } from "@/hooks/useTournaments";
import { useActiveAssignmentsWithTimeline, useCheckedInDealers } from "@/hooks/useDealerSwing";
import { supabase } from "@/integrations/supabase/client";
import { canAccessMobileCashier } from "@/lib/opsCapabilities";

type PlayerResult = {
  id: string;
  player_name: string;
  status: string;
  chip_count: number;
  entry_number: number;
  seat_number: number;
  tournament_id: string;
};

const DESKTOP_MODULES = [
  { icon: UtensilsCrossed, label: "F&B", to: "/ops/fnb" },
  { icon: Boxes, label: "Chip Ops", to: "/ops/chip-ops" },
  { icon: Megaphone, label: "Marketing", to: "/ops/marketing" },
  { icon: Coins, label: "Tài chính & Đối soát", to: "/ops/finance" },
  { icon: Scale, label: "Chốt & đối soát", to: "/ops/accounting" },
  { icon: Sparkles, label: "Trí tuệ Series", to: "/ops/series" },
];

export default function OpsMore() {
  const navigate = useNavigate();
  const { isAdmin, isClubOwner, isCashier } = useAuth();
  const { loading: clubsLoading, clubIds, dealerClubIds } = useOperatorClubs();
  const scopedIds = Array.from(new Set([...clubIds, ...dealerClubIds]));
  const activeClub = clubIds[0];
  const tournamentsQ = useTournaments(activeClub);
  const dealersQ = useCheckedInDealers(scopedIds);
  const assignmentsQ = useActiveAssignmentsWithTimeline(scopedIds);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<PlayerResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const tournamentIds = useMemo(() => (tournamentsQ.data ?? []).map((tournament) => tournament.id), [tournamentsQ.data]);
  const tournamentNames = useMemo(
    () => new Map((tournamentsQ.data ?? []).map((tournament) => [tournament.id, tournament.name])),
    [tournamentsQ.data],
  );

  useEffect(() => {
    const normalized = query.trim();
    if (!searchOpen || normalized.length < 2 || tournamentIds.length === 0) {
      setPlayers([]);
      setSearchBusy(false);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchBusy(true);
      setSearchError(null);
      const searchTerm = `%${normalized.replace(/[%_]/g, "")}%`;
      const { data, error } = await supabase
        .from("tournament_seats")
        .select("id,player_name,status,chip_count,entry_number,seat_number,tournament_id")
        .in("tournament_id", tournamentIds)
        .ilike("player_name", searchTerm)
        .order("is_active", { ascending: false })
        .limit(20);

      if (cancelled) return;
      setSearchBusy(false);
      if (error) {
        setPlayers([]);
        setSearchError("Không tải được kết quả thật. Vui lòng thử lại.");
        return;
      }
      setPlayers(data ?? []);
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchOpen, tournamentIds]);

  const assignmentByAttendance = useMemo(
    () => new Map((assignmentsQ.data ?? []).map((assignment) => [assignment.attendance_id, assignment])),
    [assignmentsQ.data],
  );
  const canOpenCashier = canAccessMobileCashier({ isAdmin, isClubOwner, isCashier });

  return (
    <div className="ios-in space-y-6 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Thêm</h1>
      </header>

      <button
        onClick={() => setSearchOpen(true)}
        className="ios-press-sm ios-fill flex w-full items-center gap-2 rounded-2xl px-4 py-3.5 text-left text-[15px] text-[#9b8e97]"
      >
        <Search className="h-[18px] w-[18px]" /> Tìm người chơi theo tên…
      </button>

      <section>
        <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Vận hành nhanh</h2>
        <div className="ios-group">
          {[
            { icon: Trophy, label: "Giải đấu", to: "/ops/tournaments" },
            { icon: LayoutGrid, label: "Bàn", to: "/ops/tables" },
            { icon: Repeat, label: "Dealer Swing", to: "/ops/dealer-swing" },
          ].map((link) => (
            <button key={link.to} onClick={() => navigate(link.to)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <link.icon className="h-5 w-5 text-[#c9a86a]" />
              <span className="flex-1 text-[16px] text-[#f2ece6]">{link.label}</span>
              <ChevronRight className="h-[18px] w-[18px] text-[#5f545c]" />
            </button>
          ))}
          {canOpenCashier ? (
            <button onClick={() => navigate("/ops/cashier")} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <Wallet className="h-5 w-5 text-[#c9a86a]" />
              <span className="flex-1 text-[16px] text-[#f2ece6]">Cashier</span>
              <ChevronRight className="h-[18px] w-[18px] text-[#5f545c]" />
            </button>
          ) : null}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Dealer đang check-in</h2>
          <span className="text-[12px] text-[#7c7079]">{dealersQ.data.length}</span>
        </div>
        {clubsLoading || dealersQ.loading || assignmentsQ.loading ? (
          <div className="ios-card grid place-items-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#c9a86a]" /></div>
        ) : dealersQ.error || assignmentsQ.error ? (
          <div className="ios-card py-7 text-center text-[14px] text-rose-300">Không tải được trạng thái dealer thật.</div>
        ) : dealersQ.data.length === 0 ? (
          <div className="ios-card py-7 text-center text-[14px] text-[#9b8e97]">Chưa có dealer check-in.</div>
        ) : (
          <div className="ios-group">
            {dealersQ.data.slice(0, 12).map((dealer) => {
              const assignment = assignmentByAttendance.get(dealer.id);
              return (
                <div key={dealer.id} className="ios-row-inset flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] text-[#f2ece6]">{dealer.dealers.full_name}</span>
                    <span className="block truncate text-[13px] text-[#9b8e97]">{assignment?.game_tables?.table_name ?? "Đang chờ bàn"}</span>
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${assignment ? "bg-sky-400/12 text-sky-300" : "bg-white/6 text-[#9b8e97]"}`}>
                    {assignment ? "Đang bàn" : "Sẵn sàng"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Dùng trên máy tính</h2>
        <div className="ios-group">
          {DESKTOP_MODULES.map((link) => (
            <button key={link.to} onClick={() => navigate(link.to)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <link.icon className="h-5 w-5 text-[#c9a86a]" />
              <span className="flex-1 text-[15px] text-[#f2ece6]">{link.label}</span>
              <span className="text-[12px] text-[#7c7079]">Máy tính</span>
              <ChevronRight className="h-[18px] w-[18px] text-[#5f545c]" />
            </button>
          ))}
        </div>
        <div className="mt-2 space-y-2">
          <RoleLockedAction label="Nhập hand (Tracker)" mode="desktopOnly" />
          <RoleLockedAction label="Xuất báo cáo đầy đủ" mode="desktopOnly" />
        </div>
      </section>

      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-[#f2ece6]"><Users className="h-[18px] w-[18px]" /> Tra cứu người chơi</SheetTitle>
          </SheetHeader>
          <div className="ios-fill mt-3 flex items-center gap-2 rounded-2xl px-4 py-3">
            <Search className="h-[18px] w-[18px] text-[#9b8e97]" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nhập ít nhất 2 ký tự…" className="flex-1 bg-transparent text-[16px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
          </div>
          <div className="mt-3 max-h-[48vh] space-y-2.5 overflow-y-auto">
            {searchBusy ? (
              <div className="grid place-items-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#c9a86a]" /></div>
            ) : searchError ? (
              <div className="py-8 text-center text-[14px] text-rose-300">{searchError}</div>
            ) : query.trim().length < 2 ? (
              <div className="py-8 text-center text-[14px] text-[#9b8e97]">Nhập tên để tìm trong các giải của CLB.</div>
            ) : players.length === 0 ? (
              <div className="py-8 text-center text-[14px] text-[#9b8e97]">Không tìm thấy trong dữ liệu hiện tại.</div>
            ) : players.map((player) => (
              <div key={player.id} className="ios-card p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-semibold text-[#f2ece6]">{player.player_name}</div>
                    <div className="truncate text-[13px] text-[#9b8e97]">{tournamentNames.get(player.tournament_id) ?? "Giải đấu"} · ghế {player.seat_number}</div>
                  </div>
                  <span className="font-mono text-[12px] text-[#c9a86a]">{player.chip_count.toLocaleString("vi-VN")}</span>
                </div>
                <div className="mt-1 text-[12px] text-[#7c7079]">Lượt vào {player.entry_number} · {player.status || "Chưa rõ trạng thái"}</div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
