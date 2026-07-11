import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, Lock, LayoutGrid, Loader2, LogIn, Monitor, AlertTriangle, Trophy, Play, Pause, SkipForward, SkipBack, Minus, Plus, Users, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTournamentTvData } from "@/hooks/useTournamentTvData";
import { groupPayoutRows } from "@/lib/tv/payoutBands";
import { RoomGrid } from "@/components/ops/shared/RoomGrid";
import { useFloorSeats } from "@/components/ops/shared/useFloorSeats";
import { FloorPlayerActions, type FloorSeatTarget } from "@/components/ops/shared/FloorPlayerActions";
import { toMockTable, toMockSeat, type MapSeat, type MapTable } from "@/components/ops/shared/floorAdapter";
import type { MockTable } from "@/components/ops/mock/opsData";
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
/** Nhánh dữ liệu đồng hồ dùng cho ĐIỀU KHIỂN (from `get_tournament_clock`, giống ClockPanel). */
interface OpsClock { is_running: boolean; remaining_seconds: number; clock_paused_at?: string | null; current_level: { level_number: number } | null }
/** Người đã bị loại — từ `tournament_entries` (status='busted') + prize join (không có ghế active). */
interface BustedRow { entry_id: string; player_id: string; entry_number: number; player_name: string; finished_place: number | null; prize: number | null; last_chip: number | null }

export default function OpsTournamentCockpit() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey) || "status";
  const setTab = (k: TabKey) => { const p = new URLSearchParams(params); p.set("tab", k); setParams(p, { replace: true }); };

  const tv = useTournamentTvData(id, { enabled: !!id });
  const d = tv.data;

  // S3 leaderboard cũ (read-only) — CHỈ khi cờ cockpitFloorActions OFF (ON dùng nguồn seats + busted mới).
  const [players, setPlayers] = useState<{ loading: boolean; error: string | null; rows: TournamentLeaderboardPlayer[] }>({ loading: false, error: null, rows: [] });
  useEffect(() => {
    if (FEATURES.cockpitFloorActions || tab !== "players" || !id) return;
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

  // ── Điều khiển đồng hồ (S1) — mirror desktop ClockPanel: Edge `tournament-live-clock`
  //    actions start/pause/resume/previous_level/next_level/adjust_time. Server-authoritative
  //    (Edge enforces quyền). Trạng thái nút đọc từ `get_tournament_clock` (nguồn desktop dùng);
  //    sau mỗi lệnh reload clock + tv.refetch() để đồng hồ lớn cập nhật. KHÔNG auto-advance (thủ
  //    công — auto để desktop/TV lo, tránh 2 client cùng nhảy level).
  const [clk, setClk] = useState<OpsClock | null>(null);
  const [clkBusy, setClkBusy] = useState(false);
  const loadClk = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase.rpc("get_tournament_clock", { p_tournament_id: id });
    if (error) return;                       // read best-effort; đồng hồ lớn đã có từ tv.data
    setClk(data as unknown as OpsClock);
  }, [id]);
  useEffect(() => { if (tab === "status") loadClk(); }, [tab, loadClk]);
  const clockAct = useCallback(async (action: string, extra?: Record<string, unknown>) => {
    if (!id || clkBusy) return;
    setClkBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-clock", { body: { tournament_id: id, action, ...extra } });
      const err = error?.message || (data as { error?: string } | null)?.error;
      if (err) { toast.error(/permission|denied|allowed/i.test(err) ? "Không có quyền điều khiển đồng hồ." : `Không thực hiện được: ${err}`); return; }
      await Promise.all([loadClk(), tv.refetch()]);   // không optimistic
    } catch (e) {
      toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Không thực hiện được");
    } finally {
      setClkBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, clkBusy, loadClk]);

  // ── Floor cockpit (cờ cockpitFloorActions): S2 sơ đồ bàn inline + S3 danh sách 3-tab thao tác ──
  const { user } = useAuth();
  const cockpitOn = FEATURES.cockpitFloorActions;
  const [floorSeen, setFloorSeen] = useState(false); // sticky: chỉ fetch floor sau khi vào tab Bàn/Người chơi
  useEffect(() => { if (cockpitOn && (tab === "tables" || tab === "players")) setFloorSeen(true); }, [cockpitOn, tab]);
  const floor = useFloorSeats(id ?? null, { enabled: cockpitOn && floorSeen });
  const [seatTarget, setSeatTarget] = useState<FloorSeatTarget | null>(null);
  const [tableSheet, setTableSheet] = useState<string | null>(null); // table_id bàn đang mở
  const [ptab, setPtab] = useState<"all" | "playing" | "busted">("all");

  const cockVms = useMemo(() => floor.tables.map((t, i) => {
    const seats = floor.seatsByTable[t.table_id] ?? [];
    return { mock: toMockTable(t, seats.length, !!d?.isBreak, 1000 + i), name: t.table_name, seats, raw: t };
  }), [floor.tables, floor.seatsByTable, d?.isBreak]);
  const tableNoById = useMemo(() => { const m = new Map<string, number | null>(); for (const t of floor.tables) m.set(t.table_id, t.table_number); return m; }, [floor.tables]);
  const playing = useMemo(() => {
    const all: MapSeat[] = [];
    for (const k of Object.keys(floor.seatsByTable)) for (const s of floor.seatsByTable[k]) if (s.is_active) all.push(s);
    return all.sort((a, b) => (b.chip_count ?? 0) - (a.chip_count ?? 0));
  }, [floor.seatsByTable]);
  const openSeat = (s: MapSeat) => setSeatTarget({ seat: toMockSeat(s), tableNo: tableNoById.get(s.table_id) ?? 0, real: s });

  // Busted list — lazy khi tab Người chơi (cờ ON). Tên lấy từ ghế inactive (giữ player_name) → profiles → id.
  const [busted, setBusted] = useState<{ loading: boolean; rows: BustedRow[] }>({ loading: false, rows: [] });
  useEffect(() => {
    if (!cockpitOn || tab !== "players" || !id) return;
    let alive = true;
    setBusted({ loading: true, rows: [] });
    (async () => {
      try {
        const [entRes, prizeRes, seatRes] = await Promise.all([
          (supabase as any).from("tournament_entries").select("id, player_id, entry_no, seat_number, finished_place, current_stack, status").eq("tournament_id", id).eq("status", "busted"),
          supabase.from("tournament_prizes").select("position, amount").eq("tournament_id", id),
          supabase.from("tournament_seats").select("player_id, entry_number, player_name, is_active").eq("tournament_id", id),
        ]);
        const prizeByPos = new Map(((prizeRes.data ?? []) as { position: number; amount: number }[]).map((p) => [p.position, p.amount]));
        const nameBySeat = new Map<string, string>();
        for (const s of (seatRes.data ?? []) as { player_id: string; entry_number: number; player_name: string | null; is_active: boolean }[]) {
          if (s.player_name) nameBySeat.set(`${s.player_id}:${s.entry_number}`, s.player_name);
        }
        const ent = (entRes.data ?? []) as { id: string; player_id: string; entry_no: number | null; seat_number: number | null; finished_place: number | null; current_stack: number | null }[];
        const needProfile = [...new Set(ent.filter((e) => !nameBySeat.has(`${e.player_id}:${e.entry_no ?? 1}`)).map((e) => e.player_id))];
        const profileName = new Map<string, string>();
        if (needProfile.length) {
          const { data: profs } = await supabase.from("profiles").select("user_id, display_name").in("user_id", needProfile);
          for (const p of (profs ?? []) as { user_id: string; display_name: string | null }[]) if (p.display_name) profileName.set(p.user_id, p.display_name);
        }
        const rows: BustedRow[] = ent.map((e) => {
          const key = `${e.player_id}:${e.entry_no ?? 1}`;
          return {
            entry_id: e.id, player_id: e.player_id, entry_number: e.entry_no ?? 1,
            player_name: nameBySeat.get(key) ?? profileName.get(e.player_id) ?? e.player_id.slice(0, 8),
            finished_place: e.finished_place,
            prize: e.finished_place != null ? (prizeByPos.get(e.finished_place) ?? null) : null,
            last_chip: e.current_stack ?? null,
          };
        }).sort((a, b) => (a.finished_place ?? 1e9) - (b.finished_place ?? 1e9));
        if (alive) setBusted({ loading: false, rows });
      } catch { if (alive) setBusted({ loading: false, rows: [] }); }
    })();
    return () => { alive = false; };
  }, [cockpitOn, tab, id]);

  // Restore người bị loại → RPC `restore_busted_player_to_seat` (un-bust + vào ghế trống + chip cũ).
  // ⚠️ SOURCE-ONLY tới khi owner apply → toast "chưa bật" nếu RPC chưa có (42883/PGRST202).
  const [restoreTarget, setRestoreTarget] = useState<BustedRow | null>(null);
  const [restoreTtId, setRestoreTtId] = useState<string | null>(null);
  const [restoreSeat, setRestoreSeat] = useState<number | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restoreTargets = useMemo(() => floor.tables.map((tb) => {
    const occ = new Set((floor.seatsByTable[tb.table_id] ?? []).filter((x) => x.is_active).map((x) => x.seat_number));
    const freeSeats = Array.from({ length: tb.max_seats }, (_, i) => i + 1).filter((n) => !occ.has(n));
    return { tt_id: tb.tt_id, table_number: tb.table_number, freeSeats };
  }).filter((tb) => tb.freeSeats.length > 0), [floor.tables, floor.seatsByTable]);
  const openRestore = (b: BustedRow) => {
    const first = restoreTargets[0] ?? null;
    setRestoreTtId(first?.tt_id ?? null);
    setRestoreSeat(first && first.freeSeats.length > 0 ? first.freeSeats[0] : null);
    setRestoreTarget(b);
  };
  const doRestore = useCallback(async () => {
    if (!restoreTarget || !restoreTtId || restoreSeat == null || restoreBusy) return;
    setRestoreBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("restore_busted_player_to_seat", {
        p_entry_id: restoreTarget.entry_id,
        p_to_tournament_table_id: restoreTtId,
        p_to_seat_number: restoreSeat,
        p_actor_user_id: user?.id ?? null,
        p_reason: "floor_restore",
      });
      if (error && (error.code === "42883" || error.code === "PGRST202" || /function.*does not exist|could not find the function/i.test(error.message ?? ""))) {
        toast.error("Chức năng khôi phục chưa được bật trên hệ thống (chờ áp dụng)."); return;
      }
      const res = (data ?? null) as { ok?: boolean; error?: string; to_table_number?: number } | null;
      if (error || !res?.ok) {
        const code = res?.error ?? error?.message;
        const map: Record<string, string> = {
          entry_not_busted: "Người này không còn ở trạng thái bị loại.",
          actor_not_allowed: "Không có quyền khôi phục cho CLB này.",
          already_active: "Người này đã đang ngồi ở bàn khác.",
          seat_occupied: "Ghế vừa có người ngồi — chọn ghế khác.",
          invalid_destination_table: "Bàn không hợp lệ hoặc đã đóng.",
          invalid_seat_number: "Số ghế không hợp lệ.",
          unauthorized: "Bạn cần đăng nhập lại.",
        };
        toast.error(code ? (map[code] ?? `Khôi phục thất bại (${code})`) : "Khôi phục thất bại"); return;
      }
      toast.success(`Đã cho ${restoreTarget.player_name} vào lại Bàn ${res.to_table_number ?? "?"} · ghế ${restoreSeat}`);
      setBusted((s) => ({ ...s, rows: s.rows.filter((r) => r.entry_id !== restoreTarget.entry_id) }));
      setRestoreTarget(null);
      floor.reload();
    } catch (e) {
      toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Khôi phục thất bại");
    } finally {
      setRestoreBusy(false);
    }
  }, [restoreTarget, restoreTtId, restoreSeat, restoreBusy, user, floor]);

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
          {/* Điều khiển đồng hồ — Tạm dừng/Tiếp tục/Bắt đầu · Level trước-tiếp · Chỉnh giờ ±1 phút.
              Cả giải (không phải 1 bàn). Server tự kiểm quyền; nút disable khi đang chạy lệnh. */}
          {clk && (
            <div className="ios-card space-y-2.5 p-3.5">
              <div className="flex items-center gap-2">
                {!clk.is_running ? (
                  <button disabled={clkBusy} onClick={() => clockAct("start")}
                    className="ios-press ios-primary flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-[15px] font-bold disabled:opacity-40">
                    <Play className="h-[18px] w-[18px]" /> Bắt đầu
                  </button>
                ) : (
                  <button disabled={clkBusy} onClick={() => clockAct("pause")}
                    className="ios-press flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-amber-400/15 py-3 text-[15px] font-bold text-amber-300 disabled:opacity-40">
                    <Pause className="h-[18px] w-[18px]" /> Tạm dừng
                  </button>
                )}
                {clk.clock_paused_at && (
                  <button disabled={clkBusy} onClick={() => clockAct("resume")}
                    className="ios-press ios-primary flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-[15px] font-bold disabled:opacity-40">
                    <Play className="h-[18px] w-[18px]" /> Tiếp tục
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button disabled={clkBusy || (clk.current_level?.level_number ?? 1) <= 1} onClick={() => clockAct("previous_level")}
                  className="ios-press ios-fill flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[13px] font-medium text-[#f2ece6] disabled:opacity-40">
                  <SkipBack className="h-4 w-4" /> Level trước
                </button>
                <button disabled={clkBusy} onClick={() => clockAct("next_level", { current_level: (clk.current_level?.level_number ?? 0) + 1 })}
                  className="ios-press ios-fill flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[13px] font-medium text-[#f2ece6] disabled:opacity-40">
                  <SkipForward className="h-4 w-4" /> Level tiếp
                </button>
              </div>
              <div className="flex items-center justify-center gap-2">
                <span className="text-[12px] text-[#9b8e97]">Chỉnh giờ:</span>
                <button disabled={clkBusy || !clk.current_level} onClick={() => clockAct("adjust_time", { delta_seconds: -60 })}
                  className="ios-press-sm ios-fill flex items-center gap-1 rounded-xl px-3 py-2 text-[13px] text-[#f2ece6] disabled:opacity-40">
                  <Minus className="h-3.5 w-3.5" /> 1 phút
                </button>
                <button disabled={clkBusy || !clk.current_level} onClick={() => clockAct("adjust_time", { delta_seconds: 60 })}
                  className="ios-press-sm ios-fill flex items-center gap-1 rounded-xl px-3 py-2 text-[13px] text-[#f2ece6] disabled:opacity-40">
                  <Plus className="h-3.5 w-3.5" /> 1 phút
                </button>
              </div>
              {clkBusy && <div className="flex items-center justify-center gap-1.5 text-[12px] text-[#9b8e97]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang cập nhật…</div>}
            </div>
          )}
          <button onClick={() => navigate(`/ops/tables?tour=${id}`)} className="ios-press ios-tinted flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-[15px] font-semibold">
            <LayoutGrid className="h-[18px] w-[18px]" /> Sơ đồ bàn
          </button>
          <DesktopNote text="Sửa cấu trúc blind — trên máy tính." />
        </div>
      )}

      {/* S2 — Bàn: cờ ON → sơ đồ inline (tap bàn → ghế → thao tác); cờ OFF → redirect cũ */}
      {tab === "tables" && (cockpitOn ? (
        <div className="space-y-3">
          {floor.loading && cockVms.length === 0 ? (
            <CenterCard icon={<Loader2 className="h-7 w-7 animate-spin text-[#c9a86a]" />} title="Đang tải sơ đồ bàn…" />
          ) : floor.error ? (
            <div className="ios-card flex flex-col items-center gap-2 py-8 text-center">
              <AlertTriangle className="h-7 w-7 text-rose-300" />
              <div className="text-[14px] font-semibold text-[#f2ece6]">Không tải được sơ đồ bàn</div>
              <div className="max-w-[280px] text-[12px] text-[#9b8e97]">{floor.error}</div>
              <button onClick={() => floor.reload()} className="ios-press-sm mt-1 flex items-center gap-1.5 rounded-full bg-white/8 px-3.5 py-1.5 text-[13px] text-[#f2ece6]"><RefreshCw className="h-3.5 w-3.5" /> Thử lại</button>
            </div>
          ) : cockVms.length === 0 ? (
            <CenterCard icon={<Users className="h-7 w-7 text-[#9b8e97]" />} title="Giải này chưa có bàn/ghế" />
          ) : (
            <RoomGrid tables={cockVms.map((v) => v.mock)} onTap={(m) => setTableSheet(cockVms.find((v) => v.mock.tableNo === m.tableNo)?.raw.table_id ?? null)} />
          )}
          <button onClick={() => navigate(`/ops/tables?tour=${id}`)} className="ios-press ios-fill flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-[14px] font-medium text-[#f2ece6]">
            <LayoutGrid className="h-[18px] w-[18px]" /> Mở màn Bàn (thêm/đóng bàn · bốc lại)
          </button>
        </div>
      ) : (
        <div className="ios-card flex flex-col items-center gap-3 py-10 text-center">
          <LayoutGrid className="h-8 w-8 text-[#c9a86a]" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Sơ đồ bàn theo giải</div>
          <div className="max-w-[260px] text-[12px] text-[#9b8e97]">Xem ghế/người/chip thật + thao tác ở màn Bàn.</div>
          <button onClick={() => navigate(`/ops/tables?tour=${id}`)} className="ios-press ios-primary rounded-2xl px-5 py-2.5 text-[14px] font-bold">Mở màn Bàn</button>
        </div>
      ))}

      {/* S3 — Người chơi: cờ ON → 3-tab (Tất cả/Đang chơi/Busted); Đang chơi chạm để thao tác,
          Busted chỉ xem (không còn ghế active). Cờ OFF → leaderboard cũ (read-only). */}
      {tab === "players" && (cockpitOn ? (() => {
        const bust = busted.rows;
        const counts = { all: playing.length + bust.length, playing: playing.length, busted: bust.length };
        const showPlaying = ptab === "all" || ptab === "playing";
        const showBusted = ptab === "all" || ptab === "busted";
        const empty = !floor.loading && !busted.loading && counts.all === 0;
        return (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              {([["all", "Tất cả"], ["playing", "Đang chơi"], ["busted", "Busted"]] as ["all" | "playing" | "busted", string][]).map(([k, label]) => (
                <button key={k} onClick={() => setPtab(k)}
                  className={cn("ios-press-sm flex-1 rounded-full px-2 py-1.5 text-[12px] font-medium", ptab === k ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
                  {label} <span className="opacity-70">{counts[k]}</span>
                </button>
              ))}
            </div>
            {(floor.loading || busted.loading) && counts.all === 0 ? (
              <CenterCard icon={<Loader2 className="h-7 w-7 animate-spin text-[#c9a86a]" />} title="Đang tải…" />
            ) : empty ? (
              <CenterCard icon={<Trophy className="h-7 w-7 text-[#9b8e97]" />} title="Chưa có người chơi" />
            ) : (
              <div className="ios-group">
                {showPlaying && playing.map((s) => (
                  <button key={`p-${s.seat_id}`} onClick={() => openSeat(s)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-[#f2ece6]">{s.player_name || s.player_id.slice(0, 8)}</span>
                      <span className="block font-mono text-[12px] text-[#9b8e97]">Bàn {tableNoById.get(s.table_id) ?? "?"} · ghế {s.seat_number}</span>
                    </span>
                    <span className="font-mono text-[13px] text-[#c9a86a]">{vnd(s.chip_count)}</span>
                  </button>
                ))}
                {showBusted && bust.map((b) => (
                  <div key={`b-${b.entry_id}`} className="ios-row-inset flex w-full items-center gap-3 px-4 py-3">
                    <span className="w-7 text-center font-mono text-[13px] text-[#9b8e97]">{b.finished_place != null ? `#${b.finished_place}` : "—"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-[#9b8e97] line-through">{b.player_name}</span>
                      <span className="block text-[12px] text-[#7c7079]">Đã loại{b.prize ? ` · thưởng ${vnd(b.prize)}` : ""}</span>
                    </span>
                    <button onClick={() => openRestore(b)} disabled={restoreTargets.length === 0}
                      className="ios-press-sm shrink-0 rounded-full bg-emerald-400/12 px-3 py-1.5 text-[12px] font-semibold text-emerald-300 disabled:opacity-40">
                      Cho vào lại
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="text-center text-[12px] text-[#7c7079]">Đang chơi: chạm để thao tác · Busted: chỉ xem</div>
          </div>
        );
      })() : (
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
      ))}

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
          {/* Satellite (nhập tay): giải vé trả ghế + tiền bubble — KHÔNG qua payout engine.
              Chỉ hiện khi cờ payoutSatelliteManual ON và giải có cơ cấu satellite. Chỉ xem;
              sửa trên máy tính (Bảng Payout Engine). */}
          {FEATURES.payoutSatelliteManual && d.satellitePayout && d.satellitePayout.rows.length > 0 && (
            <div className="ios-card overflow-hidden p-0">
              <div className="border-b border-[#241a2e] px-4 py-2.5 text-[13px] font-semibold text-[#d8bc85]">🎟️ Satellite — trả vé (nhập tay)</div>
              <div className="ios-group">
                {d.satellitePayout.rows.map((r, i) => (
                  <div key={i} className="ios-row-inset flex items-center justify-between gap-3 px-4 py-2.5 text-[14px]">
                    <span className="text-[#f2ece6]">Hạng {r.label}</span>
                    <span className="font-mono text-[#c9a86a]">{r.prize}</span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 text-[11px] text-[#7c7079]">Sửa cơ cấu satellite trên máy tính.</div>
            </div>
          )}
          <div className="ios-card p-4 text-center">
            <div className="text-[13px] text-[#9b8e97]">Prize pool <span className="text-amber-300">(Tạm tính)</span></div>
            <div className="font-mono text-[24px] font-semibold text-[#c9a86a]">{vnd(d.prizePool)}</div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">{d.prizes.length ? `Trả ${d.prizes.length} hạng · ` : ""}Tiền chuyển hộ — nợ phải trả</div>
          </div>
          {/* Grouped payout: các hạng liền kề cùng mức tiền gom thành 1 dải ("Hạng 4–6 · X / suất").
              groupPayoutRows KHÔNG gộp qua khoảng trống → không giấu hạng thiếu; không cắt bớt
              (maxRows = số hạng) vì danh sách cuộn được. Dùng chung util với màn TV. */}
          {d.prizes.length === 0 ? <CenterCard icon={<Trophy className="h-7 w-7 text-[#9b8e97]" />} title="Chưa có cơ cấu thưởng" />
            : (
              <div className="ios-group">
                {groupPayoutRows(d.prizes, d.prizes.length).rows.map((b) => {
                  const isBand = /\D/.test(b.label);              // "4–6" có ký tự ngăn cách → là dải
                  const startPos = parseInt(b.label, 10);
                  return (
                    <div key={b.label} className="ios-row-inset flex items-center justify-between px-4 py-2.5 text-[14px]">
                      <span className={startPos <= 3 ? "font-semibold text-[#d8bc85]" : "text-[#f2ece6]"}>Hạng {b.label}</span>
                      <span className="font-mono text-[#f2ece6]">{vnd(b.amount)}{isBand && <span className="text-[12px] text-[#9b8e97]"> / suất</span>}</span>
                    </div>
                  );
                })}
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

      {/* Sheet ghế 1 bàn (S2 inline) → tap ghế → thao tác người chơi */}
      <Sheet open={cockpitOn && tableSheet !== null} onOpenChange={(v) => { if (!v) setTableSheet(null); }}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">{cockVms.find((v) => v.raw.table_id === tableSheet)?.name ?? "Bàn"}</SheetTitle>
          </SheetHeader>
          {(() => {
            const seats = tableSheet ? (floor.seatsByTable[tableSheet] ?? []) : [];
            return seats.length === 0 ? (
              <div className="mt-3 py-6 text-center text-[13px] text-[#9b8e97]">Bàn trống — chưa có người ngồi.</div>
            ) : (
              <div className="ios-group mt-3">
                {seats.map((s) => (
                  <button key={s.seat_id} onClick={() => { setTableSheet(null); requestAnimationFrame(() => openSeat(s)); }} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                    <span className="w-5 font-mono text-[13px] text-[#9b8e97]">{s.seat_number}</span>
                    <span className="flex-1 truncate text-[15px] text-[#f2ece6]">{s.player_name || s.player_id.slice(0, 8)}</span>
                    <span className="font-mono text-[13px] text-[#c9a86a]">{vnd(s.chip_count)}</span>
                  </button>
                ))}
              </div>
            );
          })()}
          <div className="mt-2 text-center text-[11px] text-[#7c7079]">chạm 1 ghế → thao tác người chơi</div>
        </SheetContent>
      </Sheet>

      {/* Khôi phục người bị loại → chọn bàn·ghế trống → RPC restore_busted_player_to_seat */}
      <Sheet open={restoreTarget !== null} onOpenChange={(v) => { if (!v && !restoreBusy) setRestoreTarget(null); }}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-left">
            <SheetTitle className="text-[#f2ece6]">Cho vào lại: {restoreTarget?.player_name}</SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-[13px] text-[#9b8e97]">Trả lại <span className="font-mono text-[#c9a86a]">{vnd(restoreTarget?.last_chip)}</span> chip vào 1 ghế trống · un-bust người bị loại nhầm.</div>
          {restoreTargets.length === 0 ? (
            <div className="ios-card mt-3 flex flex-col items-center gap-2 py-8 text-center">
              <div className="text-[14px] text-[#9b8e97]">Không còn ghế trống — mở thêm bàn ở màn Bàn trước.</div>
              <button onClick={() => setRestoreTarget(null)} className="ios-press-sm mt-1 rounded-full bg-white/8 px-4 py-1.5 text-[13px] text-[#f2ece6]">Đóng</button>
            </div>
          ) : (
            <>
              <div className="ios-card mt-3 p-3.5">
                <div className="text-[12px] text-[#9b8e97]">Chọn bàn (còn ghế trống)</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {restoreTargets.map((tb) => (
                    <button key={tb.tt_id} onClick={() => { setRestoreTtId(tb.tt_id); setRestoreSeat(tb.freeSeats[0] ?? null); }}
                      className={cn("ios-press-sm grid h-8 min-w-9 place-items-center rounded-lg px-2 text-[13px] font-semibold", restoreTtId === tb.tt_id ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
                      {tb.table_number ?? "?"}
                    </button>
                  ))}
                </div>
                <div className="mt-3 text-[12px] text-[#9b8e97]">Ghế trống — chạm để chọn</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(restoreTargets.find((x) => x.tt_id === restoreTtId)?.freeSeats ?? []).map((seatNo) => (
                    <button key={seatNo} onClick={() => setRestoreSeat(seatNo)}
                      className={cn("ios-press-sm grid h-8 w-9 place-items-center rounded-lg text-[13px] font-semibold", restoreSeat === seatNo ? "bg-[#c9a86a] text-[#241A08]" : "bg-emerald-400/15 text-emerald-300")}>
                      {seatNo}
                    </button>
                  ))}
                </div>
              </div>
              <button disabled={restoreBusy || restoreTtId === null || restoreSeat === null} onClick={doRestore}
                className="ios-press ios-primary mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold disabled:opacity-40">
                {restoreBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {restoreBusy ? "Đang khôi phục…" : `Cho vào Bàn ${restoreTargets.find((x) => x.tt_id === restoreTtId)?.table_number ?? "?"} · ghế ${restoreSeat ?? "—"}`}
              </button>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Thao tác người chơi (dùng chung màn Bàn) — chỉ khi cờ ON */}
      {cockpitOn && (
        <FloorPlayerActions
          tournamentId={id}
          tournamentName={d.tournamentName}
          tournamentDate={null}
          userId={user?.id}
          floor={floor}
          target={seatTarget}
          onClose={() => setSeatTarget(null)}
        />
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
