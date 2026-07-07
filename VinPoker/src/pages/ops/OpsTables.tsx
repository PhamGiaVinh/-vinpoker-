import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Search, Plus, Shuffle, PauseCircle, XCircle, Loader2, LogIn, ChevronLeft, Users, Trophy, RefreshCw, AlertTriangle,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import { useTournaments } from "@/hooks/useTournaments";
import { RoomGrid } from "@/components/ops/shared/RoomGrid";
import { PlayerActionSheets, type PlayerTarget } from "@/components/ops/shared/PlayerActionSheets";
import {
  buildSeatsByTable, toMockTable, toMockSeat,
  type MapSeat, type MapTable,
} from "@/components/ops/shared/floorAdapter";
import type { MockSeat, MockTable } from "@/components/ops/mock/opsData";
import type { Tournament } from "@/types/tournament";

/**
 * Bàn (mobileOpsV2) — bản NỐI DỮ LIỆU THẬT (reads). Ghế/người gắn theo GIẢI:
 * bàn từ `tournament_tables`, ghế/người/chip từ Edge `tournament-live-draw {action:"get_seats"}`
 * (đúng nguồn desktop FloorTableMapPanel), realtime tournament_seats + tournament_chip_counts.
 *
 * P0 (review owner): KHÔNG BAO GIỜ fallback mock khi live lỗi (error state riêng) · stale-guard
 * requestSeq khi đổi giải nhanh · selector không tự nhảy khỏi giải user đã chọn · mọi nút hành
 * động chỉ toast "đang nối" (không import write-path) · status bàn copy verbatim desktop qua
 * floorAdapter (có vitest). P1: >1 CLB → pill chọn; realtime debounce 200ms; chip 0 ≠ null;
 * 3 empty state phân biệt; không sửa shared components (adapter lo).
 */
const PENDING_NOTICE = "Chức năng đang nối dữ liệu — chưa thao tác trên live.";

const LIVEISH_PRIMARY: Tournament["status"][] = ["live", "break", "final_table"];
const LIVEISH_FALLBACK: Tournament["status"][] = ["registering", "drawing"];

interface FloorState {
  loading: boolean;
  error: string | null;
  tables: MapTable[];
  seatsByTable: Record<string, MapSeat[]>;
}

/** Đọc bàn + ghế của 1 giải — mirror FloorTableMapPanel.load() (đọc-only). */
function useFloorSeats(tournamentId: string | null) {
  const [state, setState] = useState<FloorState>({ loading: false, error: null, tables: [], seatsByTable: {} });
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current; // P0-2: stale responses (đổi giải nhanh) bị drop
    if (!tournamentId) {
      setState({ loading: false, error: null, tables: [], seatsByTable: {} });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [ttRes, seatsRes] = await Promise.all([
        supabase.from("tournament_tables")
          .select("id, table_name, table_number, max_seats, status, table_id")
          .eq("tournament_id", tournamentId),
        supabase.functions.invoke("tournament-live-draw", { body: { tournament_id: tournamentId, action: "get_seats" } }),
      ]);
      if (seq !== seqRef.current) return;
      if (ttRes.error) throw new Error(ttRes.error.message);
      if (seatsRes.error) throw new Error(typeof seatsRes.error === "string" ? seatsRes.error : (seatsRes.error as Error).message ?? "get_seats lỗi");
      const tables: MapTable[] = ((ttRes.data ?? []) as Record<string, unknown>[])
        .map((t) => ({
          tt_id: t.id as string,
          table_id: t.table_id as string,
          table_number: (t.table_number as number | null) ?? null,
          table_name: (t.table_name as string) ?? (t.table_number != null ? `Bàn ${t.table_number}` : "Bàn ?"),
          max_seats: (t.max_seats as number) ?? 9,
          status: (t.status as string) ?? "active",
        }))
        .sort((a, b) => (a.table_number ?? 1e9) - (b.table_number ?? 1e9));
      const seats = ((seatsRes.data as { data?: MapSeat[] } | null)?.data ?? []) as MapSeat[];
      setState({ loading: false, error: null, tables, seatsByTable: buildSeatsByTable(tables, seats) });
    } catch (e) {
      if (seq !== seqRef.current) return;
      // P0-1: lỗi là lỗi — hiện error state, KHÔNG fallback mock.
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Không tải được sơ đồ bàn" }));
    }
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);

  // Realtime: seats + chip_counts của giải → debounce 200ms rồi refetch (P1-2).
  useEffect(() => {
    if (!tournamentId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => load(), 200); };
    const ch = supabase
      .channel(`ops-floor:${tournamentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_seats", filter: `tournament_id=eq.${tournamentId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_chip_counts", filter: `tournament_id=eq.${tournamentId}` }, bump)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [tournamentId, load]);

  return { ...state, reload: load };
}

interface TableVM { mock: MockTable; name: string; seats: MockSeat[]; raw: MapTable }

/** Copy VERBATIM từ AddPlayerDialog.mapError — phân biệt permission/validation/conflict (P1). */
function addPlayerError(code?: string): string {
  switch (code) {
    case "unauthorized": return "Bạn cần đăng nhập lại.";
    case "actor_not_allowed": return "Không có quyền thêm người cho CLB này.";
    case "tournament_not_open": return "Giải đã kết thúc/huỷ.";
    case "invalid_player_name": return "Tên tối thiểu 2 ký tự.";
    case "invalid_destination_table": return "Bàn không hợp lệ hoặc đã đóng.";
    case "invalid_seat_number": return "Số ghế không hợp lệ.";
    case "seat_occupied": return "Ghế vừa bị lấy — chọn ghế khác.";
    default: return code ? `Thêm người thất bại (${code})` : "Thêm người thất bại";
  }
}
/** Copy VERBATIM từ OpenTableDialog.mapError. */
function openTableError(code?: string): string {
  switch (code) {
    case "unauthorized": return "Bạn cần đăng nhập lại.";
    case "actor_not_allowed": return "Không có quyền mở bàn cho CLB này.";
    case "tournament_not_open": return "Giải đã kết thúc/huỷ.";
    case "table_number_taken": return "Số bàn này đã tồn tại — chọn số khác.";
    case "invalid_max_seats": return "Số ghế không hợp lệ (2–10).";
    case "invalid_table_number": return "Số bàn không hợp lệ.";
    default: return code ? `Mở bàn thất bại (${code})` : "Mở bàn thất bại";
  }
}
/** Copy VERBATIM từ CloseTableDialog.mapError (kèm need/have cho insufficient_capacity). */
function closeTableError(res: { error?: string; need?: number; have?: number } | null, raw?: string): string {
  const code = res?.error ?? raw;
  switch (code) {
    case "unauthorized": return "Bạn cần đăng nhập lại.";
    case "actor_not_allowed": return "Không có quyền đóng bàn cho CLB này.";
    case "tournament_not_open": return "Giải đã kết thúc/huỷ.";
    case "table_not_found": return "Không tìm thấy bàn.";
    case "insufficient_capacity": return `Không đủ ghế trống (cần ${res?.need ?? "?"}, có ${res?.have ?? "?"}) — mở thêm bàn trước khi đóng.`;
    default: return code ? `Đóng bàn thất bại (${code})` : "Đóng bàn thất bại";
  }
}
type CloseDrawMode = "redraw_balanced" | "fill_lowest_table";

export default function OpsTables() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { loading: clubsLoading, user, clubs, clubIds, dealerClubIds } = useOperatorClubs();
  const scopedIds = dealerClubIds.length > 0 ? dealerClubIds : clubIds;

  // P1-1: 1 CLB → auto; >1 → pill chọn. Đổi CLB → reset giải.
  const [clubId, setClubId] = useState<string | null>(null);
  useEffect(() => {
    if (scopedIds.length === 0) return;
    if (clubId == null || !scopedIds.includes(clubId)) setClubId(scopedIds[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedIds.join(",")]);

  const { data: tournaments, isLoading: toursLoading } = useTournaments(clubId ?? undefined);
  const tourOptions = useMemo(() => {
    const list = (tournaments ?? []) as unknown as Tournament[];
    const primary = list.filter((t) => LIVEISH_PRIMARY.includes(t.status));
    return primary.length > 0 ? primary : list.filter((t) => LIVEISH_FALLBACK.includes(t.status));
  }, [tournaments]);

  // P0-3: auto-select CHỈ khi chưa chọn hoặc giải đã chọn biến mất — không clobber lựa chọn user.
  const [tourId, setTourId] = useState<string | null>(null);
  useEffect(() => {
    if (tourOptions.length === 0) { setTourId(null); return; }
    if (tourId == null || !tourOptions.some((t) => t.id === tourId)) setTourId(tourOptions[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourOptions.map((t) => t.id).join(","), clubId]);

  const selectedTour = tourOptions.find((t) => t.id === tourId) ?? null;
  const onBreak = selectedTour?.status === "break";
  const floor = useFloorSeats(tourId);

  const [openNo, setOpenNo] = useState<number | null>(null);
  const [player, setPlayer] = useState<PlayerTarget | null>(null);
  const [searchOn, setSearchOn] = useState(false);
  const [query, setQuery] = useState("");

  const vms = useMemo<TableVM[]>(() => floor.tables.map((t, i) => {
    const seats = floor.seatsByTable[t.table_id] ?? [];
    return { mock: toMockTable(t, seats.length, onBreak, 1000 + i), name: t.table_name, seats: seats.map(toMockSeat), raw: t };
  }), [floor.tables, floor.seatsByTable, onBreak]);

  const visible = useMemo(() => {
    if (!query.trim()) return vms;
    const q = query.trim().toLowerCase();
    return vms.filter((v) => v.name.toLowerCase().includes(q) || String(v.mock.tableNo) === q
      || v.seats.some((s) => (s.name ?? "").toLowerCase().includes(q)));
  }, [vms, query]);

  const byNo = useMemo(() => new Map(vms.map((v) => [v.mock.tableNo, v])), [vms]);
  const openVM = openNo != null ? byNo.get(openNo) ?? null : null;

  const pending = () => toast(PENDING_NOTICE);
  const openPlayer = (s: MockSeat) => {
    const tableNo = openVM?.mock.tableNo ?? 0;
    setOpenNo(null);
    requestAnimationFrame(() => setPlayer({ seat: s, tableNo }));
  };

  // ── Floor-A1: Thêm người → RPC floor_assign_player_to_seat (gate floorTableOps) ──
  const ADD_LIVE = FEATURES.floorTableOps;
  const [addTable, setAddTable] = useState<TableVM | null>(null); // bàn đang thêm
  const [addName, setAddName] = useState("");
  const [addSeat, setAddSeat] = useState<number | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const addBusyRef = useRef(false);
  const openAdd = (vm: TableVM) => {
    setOpenNo(null);
    setAddName(""); setAddSeat(null);
    requestAnimationFrame(() => setAddTable(vm));
  };
  const addFreeSeats = useMemo(() => {
    if (!addTable) return [];
    const taken = new Set(addTable.seats.map((s) => s.seat));
    const out: number[] = [];
    for (let n = 1; n <= addTable.raw.max_seats; n++) if (!taken.has(n)) out.push(n);
    return out;
  }, [addTable]);
  const submitAdd = useCallback(async () => {
    if (!addTable || !tourId || addSeat == null || addName.trim().length < 2) return;
    if (addBusyRef.current) return;            // P0-7 synchronous double-tap guard
    addBusyRef.current = true; setAddBusy(true);
    try {
      // Mirror AddPlayerDialog.submit — floor_assign_player_to_seat (mig 20260913000000)
      const { data, error } = await (supabase.rpc as any)("floor_assign_player_to_seat", {
        p_tournament_id: tourId,
        p_player_name: addName.trim(),
        p_tournament_table_id: addTable.raw.tt_id,
        p_seat_number: addSeat,
      });
      const res = (data ?? null) as { ok?: boolean; error?: string; table_number?: number | null; seat_number?: number; display_name?: string } | null;
      if (error || !res?.ok) { toast.error(addPlayerError(error ? error.message : res?.error)); return; }
      toast.success(`Đã xếp ${res.display_name ?? addName.trim()} → ${addTable.name} · Ghế ${res.seat_number ?? addSeat}`);
      setAddTable(null);
      floor.reload();                          // refetch, không optimistic (P0-7)
    } catch (e) {
      toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Thêm người thất bại");
    } finally {
      addBusyRef.current = false; setAddBusy(false);
    }
  }, [addTable, tourId, addSeat, addName, floor]);

  // ── Floor-A3: Mở bàn → open_tournament_table (gate floorTableOps) ──
  const [openTableOpen, setOpenTableOpen] = useState(false);
  const [newTableNo, setNewTableNo] = useState("");
  const [newMaxSeats, setNewMaxSeats] = useState(9);
  const [openBusy, setOpenBusy] = useState(false);
  const openBusyRef = useRef(false);
  const submitOpenTable = useCallback(async () => {
    if (!tourId || newMaxSeats < 2 || newMaxSeats > 10) return;
    if (openBusyRef.current) return;
    openBusyRef.current = true; setOpenBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("open_tournament_table", {
        p_tournament_id: tourId,
        p_table_number: newTableNo.trim() ? Number(newTableNo) : null,
        p_max_seats: Number(newMaxSeats) || null,
      });
      const res = (data ?? null) as { ok?: boolean; error?: string; table_number?: number; reopened?: boolean } | null;
      if (error || !res?.ok) { toast.error(openTableError(error ? error.message : res?.error)); return; }
      toast.success(res.reopened ? `Đã mở lại Bàn ${res.table_number}` : `Đã mở Bàn ${res.table_number}`);
      setOpenTableOpen(false); setNewTableNo("");
      floor.reload();
    } catch (e) {
      toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Mở bàn thất bại");
    } finally {
      openBusyRef.current = false; setOpenBusy(false);
    }
  }, [tourId, newTableNo, newMaxSeats, floor]);

  // ── Floor-A3: Đóng bàn → close_tournament_table (redistribute; gate floorTableOps) ──
  const [closeTable, setCloseTable] = useState<TableVM | null>(null);
  const [closeMode, setCloseMode] = useState<CloseDrawMode>("redraw_balanced");
  const [closeBusy, setCloseBusy] = useState(false);
  const closeBusyRef = useRef(false);
  const submitCloseTable = useCallback(async () => {
    if (!closeTable) return;
    if (closeBusyRef.current) return;
    closeBusyRef.current = true; setCloseBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("close_tournament_table", {
        p_tournament_table_id: closeTable.raw.tt_id,
        p_draw_mode: closeMode,
        p_reason: "table_break",
      });
      const res = (data ?? null) as { ok?: boolean; error?: string; need?: number; have?: number; moved?: unknown[] } | null;
      if (error || !res?.ok) { toast.error(closeTableError(res, error?.message)); return; }
      toast.success(`Đã đóng ${closeTable.name} · chuyển ${res.moved?.length ?? 0} người`);
      setCloseTable(null);
      floor.reload();
    } catch (e) {
      toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Đóng bàn thất bại");
    } finally {
      closeBusyRef.current = false; setCloseBusy(false);
    }
  }, [closeTable, closeMode, floor]);

  // ---- guards (thứ tự chuẩn: auth → login → clubs → quyền → data) ----
  if (clubsLoading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Kiểm tra đăng nhập." onBack={() => navigate("/")} />;
  if (!user) return <Guard icon={<LogIn className="h-8 w-8 text-[#c9a86a]" />} title="Cần đăng nhập" sub="Đăng nhập tài khoản floor/cashier để xem sơ đồ bàn thật." onBack={() => navigate("/")} />;
  if (clubs === null) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Lấy câu lạc bộ." onBack={() => navigate("/")} />;
  if (scopedIds.length === 0 && !isAdmin) return <Guard icon={<Users className="h-8 w-8 text-amber-300" />} title="Chưa được phân công CLB" sub="Liên hệ quản trị để được gán quyền vận hành sàn." onBack={() => navigate("/")} />;

  const clubName = (id: string) => clubs?.find((c) => c.id === id)?.name ?? `CLB ${id.slice(0, 4)}…`;

  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Bàn</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">{selectedTour ? selectedTour.name : "Cả phòng trong một màn"} · chạm 1 bàn để thao tác</p>
      </header>

      <div className="rounded-xl bg-amber-400/8 px-3 py-2 text-[12px] text-amber-300/90">
        Dữ liệu thật · nút hành động chưa nối
      </div>

      {/* P1-1: >1 CLB → pill chọn CLB */}
      {scopedIds.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-1">
          {scopedIds.map((id) => (
            <button key={id} onClick={() => { if (id !== clubId) { setClubId(id); setTourId(null); } }}
              className={cn("ios-press-sm shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium", clubId === id ? "bg-white/12 text-[#f2ece6]" : "bg-white/5 text-[#9b8e97]")}>
              {clubName(id)}
            </button>
          ))}
        </div>
      )}

      {/* P0-3: pill chọn giải (ẩn nếu chỉ 1) */}
      {tourOptions.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-1">
          {tourOptions.map((t) => (
            <button key={t.id} onClick={() => setTourId(t.id)}
              className={cn("ios-press-sm shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium", tourId === t.id ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {searchOn && (
        <div className="ios-fill flex items-center gap-2 rounded-2xl px-4 py-3">
          <Search className="h-[18px] w-[18px] text-[#9b8e97]" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Số bàn / tên người chơi…"
            className="flex-1 bg-transparent text-[15px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
        </div>
      )}

      {/* ---- vùng dữ liệu: loading → error → empty② → empty③ → grid (KHÔNG BAO GIỜ mock) ---- */}
      {toursLoading || (floor.loading && vms.length === 0) ? (
        <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#c9a86a]" />
          <div className="text-[13px] text-[#9b8e97]">Đang tải sơ đồ bàn…</div>
        </div>
      ) : floor.error ? (
        <div className="ios-card flex flex-col items-center gap-2 py-10 text-center">
          <AlertTriangle className="h-7 w-7 text-rose-300" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Không tải được sơ đồ bàn</div>
          <div className="max-w-[280px] text-[12px] text-[#9b8e97]">{floor.error}</div>
          <button onClick={() => floor.reload()} className="ios-press-sm mt-1 flex items-center gap-1.5 rounded-full bg-white/8 px-3.5 py-1.5 text-[13px] text-[#f2ece6]">
            <RefreshCw className="h-3.5 w-3.5" /> Thử lại
          </button>
        </div>
      ) : !selectedTour ? (
        <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
          <Trophy className="h-7 w-7 text-amber-300" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Chưa có giải đang chạy</div>
          <div className="max-w-[260px] text-[12px] text-[#9b8e97]">Sơ đồ bàn hiển thị theo giải. Mở giải ở tab Giải đấu trước.</div>
        </div>
      ) : vms.length === 0 ? (
        <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
          <Users className="h-7 w-7 text-[#9b8e97]" />
          <div className="text-[15px] font-semibold text-[#f2ece6]">Giải này chưa có bàn/ghế</div>
          <div className="max-w-[260px] text-[12px] text-[#9b8e97]">Bàn sẽ hiện khi giải được gắn bàn và bốc chỗ.</div>
        </div>
      ) : (
        <RoomGrid tables={visible.map((v) => v.mock)} onTap={(m) => setOpenNo(m.tableNo)} />
      )}

      {/* hàng nút đáy — thumb zone (hành động: đang nối) */}
      <div className="flex items-center gap-2">
        <button onClick={() => { setSearchOn((v) => !v); if (searchOn) setQuery(""); }} className="ios-press ios-fill grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-[#f2ece6]">
          <Search className="h-5 w-5" />
        </button>
        <button onClick={() => (ADD_LIVE ? (setNewTableNo(""), setNewMaxSeats(9), setOpenTableOpen(true)) : undefined)} disabled={!ADD_LIVE}
          className={cn("ios-press ios-fill flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl text-[15px] font-medium text-[#f2ece6]", !ADD_LIVE && "opacity-50")}>
          <Plus className="h-[18px] w-[18px]" /> {ADD_LIVE ? "Bàn" : "Cần bật cờ"}
        </button>
        <button onClick={pending} className="ios-press ios-fill flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl text-[15px] font-medium text-[#f2ece6]">
          <Shuffle className="h-[18px] w-[18px]" /> Bốc lại
        </button>
      </div>

      {/* B2 — sheet bàn: ghế + người thật */}
      <Sheet open={openVM !== null} onOpenChange={(v) => { if (!v) setOpenNo(null); }}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">{openVM?.name}</SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-center font-mono text-[13px] text-[#9b8e97]">
            {openVM?.mock.occ}/{openVM?.mock.max} ghế{onBreak ? " · đang giải lao" : ""}
          </div>

          <div className="mt-3 flex flex-wrap justify-center gap-1">
            {openVM && Array.from({ length: openVM.mock.max }, (_, i) => i + 1).map((n) => {
              const s = openVM.seats.find((x) => x.seat === n);
              return (
                <button key={n} onClick={() => s && openPlayer(s)} disabled={!s}
                  className={cn("ios-press-sm grid h-7 w-7 place-items-center rounded-md text-[12px] font-semibold",
                    s ? "bg-[#2c2135] text-[#f2ece6]" : "bg-white/4 text-[#5f545c]")}>
                  {n}
                </button>
              );
            })}
          </div>
          <div className="mt-1 text-center text-[11px] text-[#7c7079]">chạm 1 ghế → thao tác người chơi</div>

          {openVM && openVM.seats.length > 0 && (
            <div className="ios-group mt-3">
              {openVM.seats.map((s) => (
                <button key={s.seat} onClick={() => openPlayer(s)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="w-5 font-mono text-[13px] text-[#9b8e97]">{s.seat}</span>
                  <span className="flex-1 truncate text-[15px] text-[#f2ece6]">{s.name}</span>
                  <span className="font-mono text-[13px] text-[#c9a86a]">{s.chip}</span>
                </button>
              ))}
            </div>
          )}
          {openVM && openVM.seats.length === 0 && (
            <div className="mt-3 py-4 text-center text-[13px] text-[#9b8e97]">Bàn trống — chưa có người ngồi.</div>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2">
            {/* Floor-A1: LIVE (floorTableOps). Cờ OFF → disable "Cần bật cờ" y desktop, 0 gọi RPC. */}
            <button onClick={() => (ADD_LIVE ? openVM && openAdd(openVM) : undefined)} disabled={!ADD_LIVE}
              className={cn("ios-press ios-tinted flex items-center justify-center gap-1 rounded-2xl py-3 text-[13px] font-semibold", !ADD_LIVE && "opacity-50")}>
              <Plus className="h-4 w-4" /> {ADD_LIVE ? "Thêm người" : "Cần bật cờ"}
            </button>
            <button onClick={pending} className="ios-press ios-fill flex items-center justify-center gap-1 rounded-2xl py-3 text-[13px] font-medium text-amber-300">
              <PauseCircle className="h-4 w-4" /> Tạm dừng
            </button>
            <button onClick={() => { if (!ADD_LIVE) { pending(); return; } const vm = openVM; setOpenNo(null); setCloseMode("redraw_balanced"); requestAnimationFrame(() => setCloseTable(vm)); }}
              className="ios-press flex items-center justify-center gap-1 rounded-2xl bg-rose-500/12 py-3 text-[13px] font-semibold text-rose-300">
              <XCircle className="h-4 w-4" /> {ADD_LIVE ? "Đóng bàn" : "Cần bật cờ"}
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Floor-A1 — Thêm người (N4): tên + ghế trống + nhắc lại → floor_assign_player_to_seat */}
      <Sheet open={addTable !== null} onOpenChange={(v) => { if (!v && !addBusy) setAddTable(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Thêm người → {addTable?.name}</SheetTitle></SheetHeader>
          <div className="mt-1 text-center text-[12px] text-[#9b8e97]">xếp khách vào ghế trống · không thu tiền (buy-in ở quầy)</div>
          <div className="mt-3">
            <label className="px-1 text-[12px] text-[#9b8e97]">Tên người chơi</label>
            <input autoFocus value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="VD: Nguyễn Văn A"
              className="ios-fill mt-1 w-full rounded-xl px-3 py-2.5 text-[15px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
          </div>
          <div className="mt-3">
            <label className="px-1 text-[12px] text-[#9b8e97]">Ghế trống</label>
            {addFreeSeats.length === 0 ? (
              <div className="ios-fill mt-1 rounded-xl py-3 text-center text-[13px] text-[#9b8e97]">Bàn đã đầy — không còn ghế trống.</div>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {addFreeSeats.map((n) => (
                  <button key={n} onClick={() => setAddSeat(n)}
                    className={cn("ios-press-sm grid h-10 w-11 place-items-center rounded-lg text-[15px] font-semibold",
                      addSeat === n ? "bg-[#c9a86a] text-[#241A08]" : "bg-emerald-400/15 text-emerald-300")}>{n}</button>
                ))}
              </div>
            )}
          </div>
          <button
            disabled={addBusy || addName.trim().length < 2 || addSeat == null}
            onClick={submitAdd}
            className="ios-press ios-primary mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold disabled:opacity-40">
            {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {addBusy ? "Đang xếp…" : addSeat != null && addName.trim() ? `Xếp ${addName.trim()} vào ghế ${addSeat}` : "Chọn tên & ghế"}
          </button>
          <div className="mt-2 text-center text-[11px] text-[#7c7079]">nhắc lại: {addName.trim() || "—"} → {addTable?.name} · ghế {addSeat ?? "—"}</div>
        </SheetContent>
      </Sheet>

      {/* Floor-A3 — Mở bàn: số bàn (trống=tự đánh số / nhập số bàn đã đóng = mở lại) + số ghế */}
      <Sheet open={openTableOpen} onOpenChange={(v) => { if (!v && !openBusy) setOpenTableOpen(false); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Mở bàn mới</SheetTitle></SheetHeader>
          <div className="mt-1 text-center text-[12px] text-[#9b8e97]">nhập đúng số bàn đã đóng để <b>mở lại</b> · không thu tiền</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="px-1 text-[12px] text-[#9b8e97]">Số bàn (trống = tự động)</label>
              <input inputMode="numeric" value={newTableNo} onChange={(e) => setNewTableNo(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Tự động"
                className="ios-fill mt-1 w-full rounded-xl px-3 py-2.5 text-center font-mono text-[16px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
            </div>
            <div>
              <label className="px-1 text-[12px] text-[#9b8e97]">Số ghế (2–10)</label>
              <div className="ios-fill mt-1 flex items-center justify-between rounded-xl px-2 py-1.5">
                <button onClick={() => setNewMaxSeats((v) => Math.max(2, v - 1))} className="ios-press-sm grid h-8 w-8 place-items-center rounded-lg bg-white/6 text-[#f2ece6]">−</button>
                <span className="font-mono text-[16px] text-[#f2ece6]">{newMaxSeats}</span>
                <button onClick={() => setNewMaxSeats((v) => Math.min(10, v + 1))} className="ios-press-sm grid h-8 w-8 place-items-center rounded-lg bg-white/6 text-[#f2ece6]">+</button>
              </div>
            </div>
          </div>
          <button disabled={openBusy || newMaxSeats < 2 || newMaxSeats > 10} onClick={submitOpenTable}
            className="ios-press ios-primary mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold disabled:opacity-40">
            {openBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {openBusy ? "Đang mở…" : newTableNo ? `Mở Bàn ${newTableNo}` : "Mở bàn (tự đánh số)"}
          </button>
        </SheetContent>
      </Sheet>

      {/* Floor-A3 — Đóng bàn: chọn cách chia người + nhắc lại → close_tournament_table */}
      <Sheet open={closeTable !== null} onOpenChange={(v) => { if (!v && !closeBusy) setCloseTable(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-rose-300">Đóng {closeTable?.name}</SheetTitle></SheetHeader>
          <div className="mt-1 text-center text-[13px] text-[#9b8e97]">
            {(closeTable?.seats.length ?? 0) > 0
              ? <>chuyển <b className="text-[#f2ece6]">{closeTable?.seats.length}</b> người sang ghế trống bàn khác rồi đóng · không hoàn tác</>
              : "bàn trống — đóng ngay, không phải chuyển ai"}
          </div>
          {(closeTable?.seats.length ?? 0) > 0 && (
            <div className="mt-3">
              <div className="px-1 text-[12px] text-[#9b8e97]">Cách chia người</div>
              <div className="mt-1.5 space-y-1.5">
                {([["redraw_balanced", "Bốc ngẫu nhiên, ưu tiên bàn ít người"], ["fill_lowest_table", "Lấp bàn số nhỏ trước"]] as [CloseDrawMode, string][]).map(([m, label]) => (
                  <button key={m} onClick={() => setCloseMode(m)}
                    className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[14px]", closeMode === m ? "bg-[#c9a86a]/15 text-[#f2ece6] ring-1 ring-[#c9a86a]/40" : "ios-fill text-[#9b8e97]")}>
                    <span className={cn("grid h-4 w-4 place-items-center rounded-full border", closeMode === m ? "border-[#c9a86a] bg-[#c9a86a]" : "border-white/25")} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-2 px-1 text-[11px] text-[#7c7079]">thiếu ghế trống → server chặn, không tự mở bàn (mở thêm bàn trước).</div>
            </div>
          )}
          <button disabled={closeBusy} onClick={submitCloseTable}
            className="ios-press mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500/90 py-3.5 text-[15px] font-bold text-white disabled:opacity-40">
            {closeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            {closeBusy ? "Đang đóng…" : (closeTable?.seats.length ?? 0) > 0 ? `Đóng & chuyển ${closeTable?.seats.length} người` : "Đóng bàn"}
          </button>
        </SheetContent>
      </Sheet>

      {/* S7 — tap người: hiện danh tính thật; mọi nút con toast "đang nối" (P0-4) */}
      <PlayerActionSheets target={player} onClose={() => setPlayer(null)} pendingNotice={PENDING_NOTICE} />
    </div>
  );
}

function Guard({ icon, title, sub, onBack }: { icon: React.ReactNode; title: string; sub: string; onBack: () => void }) {
  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <button onClick={onBack} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Bàn</h1>
      </header>
      <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
        {icon}
        <div className="mt-1 text-[16px] font-semibold text-[#f2ece6]">{title}</div>
        <div className="max-w-[260px] text-[13px] text-[#9b8e97]">{sub}</div>
      </div>
    </div>
  );
}
