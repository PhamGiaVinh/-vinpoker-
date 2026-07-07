import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, Lock, LayoutGrid, Loader2, LogIn, Monitor, AlertTriangle, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTournamentTvData } from "@/hooks/useTournamentTvData";
import type { TournamentLeaderboardPlayer } from "@/types/tournament";

/**
 * Cockpit giải (mobileOpsV2) — bản NỐI DỮ LIỆU THẬT (reads S1/S3/S4/S5).
 * S1 Trạng thái + S5 Trả thưởng ← `useTournamentTvData(id)` (clock/level/players/prizes thật).
 * S3 Người chơi ← RPC `get_tournament_leaderboard`. S4 Levels ← `tournament_levels`.
 * S2 Bàn → mở màn Bàn (dữ liệu ghế theo giải ở đó). S6 Lịch sử đầy đủ = máy tính.
 * READ-ONLY: sửa clock/blind/cơ cấu = máy tính; thao tác người chơi ở màn Bàn.
 */
const TABS = [
  { key: "status", label: "Trạng thái" },
  { key: "tables", label: "Bàn" },
  { key: "players", label: "Người chơi" },
  { key: "levels", label: "Levels" },
  { key: "payout", label: "Trả thưởng" },
  { key: "history", label: "Lịch sử" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const vnd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("vi-VN"));
const mmss = (s: number) => {
  const x = Math.max(0, Math.floor(s));
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

interface LevelRow { level_number: number; small_blind: number; big_blind: number; ante: number; duration_minutes: number; is_break: boolean }

export default function OpsTournamentCockpit() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey) || "status";
  const setTab = (k: TabKey) => { const p = new URLSearchParams(params); p.set("tab", k); setParams(p, { replace: true }); };

  const tv = useTournamentTvData(id, { enabled: !!id });
  const d = tv.data;

  // S3 leaderboard — lazy khi mở tab
  const [players, setPlayers] = useState<{ loading: boolean; error: string | null; rows: TournamentLeaderboardPlayer[] }>({ loading: false, error: null, rows: [] });
  useEffect(() => {
    if (tab !== "players" || !id) return;
    let alive = true;
    setPlayers({ loading: true, error: null, rows: [] });
    (async () => {
      try {
        const { data, error } = await (supabase.rpc as any)("get_tournament_leaderboard", { p_tournament_id: id });
        if (error) throw error;
        const rows = ((data?.players ?? data) as TournamentLeaderboardPlayer[]) ?? [];
        if (alive) setPlayers({ loading: false, error: null, rows: Array.isArray(rows) ? rows : [] });
      } catch (e) { if (alive) setPlayers({ loading: false, error: e instanceof Error ? e.message : "Không tải được bảng người chơi", rows: [] }); }
    })();
    return () => { alive = false; };
  }, [tab, id]);

  // S4 levels — lazy
  const [levels, setLevels] = useState<{ loading: boolean; error: string | null; rows: LevelRow[] }>({ loading: false, error: null, rows: [] });
  useEffect(() => {
    if (tab !== "levels" || !id) return;
    let alive = true;
    setLevels({ loading: true, error: null, rows: [] });
    (async () => {
      try {
        const { data, error } = await supabase.from("tournament_levels")
          .select("level_number, small_blind, big_blind, ante, duration_minutes, is_break")
          .eq("tournament_id", id).order("level_number");
        if (error) throw error;
        if (alive) setLevels({ loading: false, error: null, rows: (data ?? []) as LevelRow[] });
      } catch (e) { if (alive) setLevels({ loading: false, error: e instanceof Error ? e.message : "Không tải được cấu trúc", rows: [] }); }
    })();
    return () => { alive = false; };
  }, [tab, id]);

  const header = (title: string, badge?: React.ReactNode) => (
    <header className="px-1">
      <button onClick={() => navigate("/ops/tournaments")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
        <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> Giải đấu
      </button>
      <div className="mt-1 flex items-center gap-2">
        <h1 className="truncate text-[24px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">{title}</h1>
        {badge}
      </div>
    </header>
  );

  // ---- tv.state guards ----
  if (tv.state === "loading") return <Shell>{header("Đang tải…")}<Center icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải giải…" /></Shell>;
  if (tv.state === "auth_required") return <Shell>{header("Cần đăng nhập")}<Center icon={<LogIn className="h-8 w-8 text-[#c9a86a]" />} title="Cần đăng nhập" sub="Đăng nhập để xem cockpit giải." /></Shell>;
  if (tv.state === "not_found" || !id) return <Shell>{header("Không tìm thấy")}<Center icon={<Trophy className="h-8 w-8 text-amber-300" />} title="Không tìm thấy giải" sub="Giải không tồn tại hoặc đã bị xoá." /></Shell>;
  if (tv.state === "error" || !d) return <Shell>{header("Lỗi")}<Center icon={<AlertTriangle className="h-8 w-8 text-rose-300" />} title="Không tải được giải" sub="Thử lại sau." action={<button onClick={() => tv.refetch()} className="ios-press-sm mt-1 rounded-full bg-white/8 px-3.5 py-1.5 text-[13px] text-[#f2ece6]">Thử lại</button>} /></Shell>;

  const lv = d.currentLevel;

  return (
    <div className="ios-in space-y-4 pt-1">
      {header(d.tournamentName, d.isRunning ? (
        <span className="flex items-center gap-1 rounded-full bg-emerald-400/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
          <span className="ios-pulse h-1.5 w-1.5 rounded-full bg-emerald-400" /> {d.isBreak ? "Giải lao" : "Live"}
        </span>
      ) : (
        <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] font-semibold text-[#9b8e97]">{d.status}</span>
      ))}

      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-1.5">
          {TABS.map((tb) => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={cn("ios-press-sm whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium", tab === tb.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      {/* S1 — Trạng thái */}
      {tab === "status" && (
        <div className="space-y-3">
          <section className="ios-glow">
            <div className="ios-card p-5 text-center">
              <div className="text-[13px] text-[#9b8e97]">{lv?.isBreak ? "Giải lao · còn" : `Level ${lv?.levelNumber ?? "—"} · còn`}</div>
              <div className="font-mono text-[46px] font-bold leading-none text-[#c9a86a] [text-shadow:0_2px_16px_rgba(201,168,106,0.35)]">{mmss(d.remainingSeconds)}</div>
              {lv && !lv.isBreak && <div className="mt-1 font-mono text-[16px] text-[#f2ece6]">{vnd(lv.smallBlind)}/{vnd(lv.bigBlind)} <span className="text-[#9b8e97]">· ante {vnd(lv.ante)}</span></div>}
              {d.nextLevel && <div className="mt-1 text-[13px] text-[#9b8e97]">Tiếp: {d.nextLevel.isBreak ? "Nghỉ" : `L${d.nextLevel.levelNumber} · ${vnd(d.nextLevel.smallBlind)}/${vnd(d.nextLevel.bigBlind)}`}</div>}
            </div>
          </section>
          <div className="ios-card grid grid-cols-2 gap-y-3 p-4 text-center">
            <Metric label="Còn lại" v={<span>{d.playersRemaining}{d.totalEntries ? <span className="text-[#9b8e97]">/{d.totalEntries}</span> : null}</span>} />
            <Metric label="TB stack" v={vnd(d.averageStack)} />
            <Metric label="Entries" v={vnd(d.totalEntries)} />
            <Metric label={<span>Pool <span className="text-amber-300">(Tạm tính)</span></span>} v={<span className="text-[#c9a86a]">{vnd(d.prizePool)}</span>} />
          </div>
          <button onClick={() => navigate("/ops/tables")} className="ios-press ios-tinted flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-[15px] font-semibold">
            <LayoutGrid className="h-[18px] w-[18px]" /> Sơ đồ bàn
          </button>
          <DesktopNote text="Sửa clock / blind — trên máy tính." />
        </div>
      )}

      {/* S2 — Bàn → màn Bàn */}
      {tab === "tables" && (
        <div className="ios-card flex flex-col items-center gap-3 py-10 text-center">
          <LayoutGrid className="h-8 w-8 text-[#c9a86a]" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Sơ đồ bàn theo giải</div>
          <div className="max-w-[260px] text-[12px] text-[#9b8e97]">Xem ghế/người/chip thật + thao tác ở màn Bàn.</div>
          <button onClick={() => navigate("/ops/tables")} className="ios-press ios-primary rounded-2xl px-5 py-2.5 text-[14px] font-bold">Mở màn Bàn</button>
        </div>
      )}

      {/* S3 — Người chơi (thật, read-only) */}
      {tab === "players" && (
        players.loading ? <CenterCard icon={<Loader2 className="h-7 w-7 animate-spin text-[#c9a86a]" />} title="Đang tải…" />
          : players.error ? <CenterCard icon={<AlertTriangle className="h-7 w-7 text-rose-300" />} title="Không tải được" sub={players.error} />
          : players.rows.length === 0 ? <CenterCard icon={<Trophy className="h-7 w-7 text-[#9b8e97]" />} title="Chưa có người chơi" />
          : (
            <div className="space-y-2">
              <div className="ios-group">
                {players.rows.filter((p) => p.is_active !== false).sort((a, b) => b.chip_count - a.chip_count).map((p) => (
                  <div key={`${p.player_id}-${p.entry_number}`} className="ios-row-inset flex w-full items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-[#f2ece6]">{p.player_name ?? "—"}</span>
                      <span className="block font-mono text-[12px] text-[#9b8e97]">{p.table_id ? `Bàn · ghế ${p.seat_number ?? "?"}` : "chưa xếp"}{p.is_itm ? " · ITM" : ""}</span>
                    </span>
                    <span className="font-mono text-[13px] text-[#c9a86a]">{vnd(p.chip_count)}</span>
                  </div>
                ))}
              </div>
              <div className="text-center text-[12px] text-[#7c7079]">chỉ xem · thao tác người chơi ở màn Bàn</div>
            </div>
          )
      )}

      {/* S4 — Levels (thật) */}
      {tab === "levels" && (
        levels.loading ? <CenterCard icon={<Loader2 className="h-7 w-7 animate-spin text-[#c9a86a]" />} title="Đang tải…" />
          : levels.error ? <CenterCard icon={<AlertTriangle className="h-7 w-7 text-rose-300" />} title="Không tải được" sub={levels.error} />
          : levels.rows.length === 0 ? <CenterCard icon={<Trophy className="h-7 w-7 text-[#9b8e97]" />} title="Chưa có cấu trúc blind" />
          : (
            <div className="space-y-3">
              <div className="ios-group">
                <div className="ios-row-inset grid grid-cols-4 px-4 py-2 text-[11px] uppercase tracking-wide text-[#9b8e97]">
                  <span>L</span><span>Phút</span><span>SB/BB</span><span className="text-right">Ante</span>
                </div>
                {levels.rows.map((l, i) => {
                  const current = lv != null && !l.is_break && l.level_number === lv.levelNumber;
                  return l.is_break ? (
                    <div key={i} className="ios-row-inset bg-[#171122] px-4 py-2.5 text-[13px] text-[#9b8e97]">☕ Nghỉ {l.duration_minutes} phút</div>
                  ) : (
                    <div key={i} className={cn("ios-row-inset grid grid-cols-4 px-4 py-2.5 text-[13px]", current && "border-l-2 border-[#c9a86a] bg-[#241a0c]")}>
                      <span className={current ? "font-semibold text-[#d8bc85]" : "text-[#f2ece6]"}>L{l.level_number}{current && " ●"}</span>
                      <span className="text-[#9b8e97]">{l.duration_minutes}</span>
                      <span className={cn("font-mono", current ? "text-[#d8bc85]" : "text-[#f2ece6]")}>{vnd(l.small_blind)}/{vnd(l.big_blind)}</span>
                      <span className="text-right font-mono text-[#9b8e97]">{l.ante ? vnd(l.ante) : "—"}</span>
                    </div>
                  );
                })}
              </div>
              <DesktopNote text="Sửa cấu trúc — trên máy tính." />
            </div>
          )
      )}

      {/* S5 — Trả thưởng (thật) */}
      {tab === "payout" && (
        <div className="space-y-3">
          <div className="ios-card p-4 text-center">
            <div className="text-[13px] text-[#9b8e97]">Prize pool <span className="text-amber-300">(Tạm tính)</span></div>
            <div className="font-mono text-[24px] font-semibold text-[#c9a86a]">{vnd(d.prizePool)}</div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">{d.prizes.length ? `Trả ${d.prizes.length} hạng · ` : ""}Tiền chuyển hộ — nợ phải trả</div>
          </div>
          {d.prizes.length === 0 ? <CenterCard icon={<Trophy className="h-7 w-7 text-[#9b8e97]" />} title="Chưa có cơ cấu thưởng" />
            : (
              <div className="ios-group">
                {d.prizes.slice().sort((a, b) => a.position - b.position).map((p) => (
                  <div key={p.position} className="ios-row-inset flex items-center justify-between px-4 py-2.5 text-[14px]">
                    <span className={p.position <= 3 ? "font-semibold text-[#d8bc85]" : "text-[#f2ece6]"}>Hạng {p.position}</span>
                    <span className="font-mono text-[#f2ece6]">{vnd(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          <DesktopNote text="Chỉ xem — sửa cơ cấu trên máy tính." />
        </div>
      )}

      {/* S6 — Lịch sử → máy tính */}
      {tab === "history" && (
        <div className="ios-card flex flex-col items-center gap-2 py-10 text-center">
          <Monitor className="h-7 w-7 text-[#9b8e97]" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Lịch sử chi tiết trên máy tính</div>
          <div className="max-w-[260px] text-[12px] text-[#9b8e97]">Nhật ký loại/chuyển/level/chip đầy đủ (ai · lúc nào) xem trên bản máy tính.</div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, v }: { label: React.ReactNode; v: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[22px] font-semibold leading-none text-[#f2ece6]">{v}</div>
      <div className="mt-1 text-[11px] text-[#9b8e97]">{label}</div>
    </div>
  );
}
function DesktopNote({ text }: { text: string }) {
  return <div className="ios-fill flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[12px] text-[#7c7079]"><Lock className="h-3.5 w-3.5" /> {text}</div>;
}
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="ios-in space-y-4 pt-1">{children}</div>;
}
function Center({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
      {icon}<div className="mt-1 text-[16px] font-semibold text-[#f2ece6]">{title}</div>
      {sub && <div className="max-w-[260px] text-[13px] text-[#9b8e97]">{sub}</div>}
      {action}
    </div>
  );
}
function CenterCard({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="ios-card flex flex-col items-center gap-2 py-10 text-center">
      {icon}<div className="mt-1 text-[15px] font-semibold text-[#f2ece6]">{title}</div>
      {sub && <div className="max-w-[280px] text-[12px] text-[#9b8e97]">{sub}</div>}
    </div>
  );
}
