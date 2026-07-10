import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";
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
/** Copy VERBATIM từ RedrawLauncherDialog.mapError. */
function redrawError(res: { error?: string; need?: number; have?: number } | null, raw?: string): string {
  const code = res?.error ?? raw;
  switch (code) {
    case "unauthorized": return "Bạn cần đăng nhập lại.";
    case "actor_not_allowed": return "Không có quyền bốc lại cho CLB này.";
    case "tournament_not_open": return "Giải đã kết thúc/huỷ.";
    case "invalid_mode": return "Chế độ không hợp lệ.";
    case "manual_requires_entry_ids": return "Hãy chọn ít nhất 1 người chơi.";
    case "no_target_tables": return "Không có bàn đích hợp lệ.";
    case "insufficient_capacity": return `Không đủ ghế trống (cần ${res?.need ?? "?"}, có ${res?.have ?? "?"}) — mở thêm bàn / tăng số bàn đích.`;
    default: return code ? `Bốc lại thất bại (${code})` : "Bốc lại thất bại";
  }
}
// 3 chế độ tự động (thủ công = máy tính, cần chọn từng người). Draw mode dùng chung CloseDrawMode.
type RedrawMode = "final_table" | "itm" | "table_count_threshold";
interface RedrawResult {
  ok?: boolean; error?: string; need?: number; have?: number; moved_count?: number;
  moves?: { player_name?: string; to_table_number?: number | null }[];
  tables_to_close?: { table_number?: number }[];
}

/** Copy VERBATIM từ MovePlayerDialog.mapError (permission/entry/seat conflict). */
function moveError(res: { error?: string; max_seats?: number } | null, raw?: string): string {
  const code = res?.error ?? raw;
  switch (code) {
    case "entry_not_found": return "Không tìm thấy entry của người chơi.";
    case "entry_not_seated": return "Người chơi không còn ở trạng thái đang ngồi.";
    case "actor_not_allowed": return "Không có quyền chuyển ghế cho CLB này.";
    case "no_active_seat": return "Người chơi không có ghế active — kiểm tra Table Draw.";
    case "invalid_destination_table": return "Bàn đích không hợp lệ hoặc đã đóng — tải lại danh sách bàn.";
    case "invalid_seat_number": return `Số ghế không hợp lệ${res?.max_seats ? ` (1–${res.max_seats})` : ""}.`;
    case "seat_occupied": return "Ghế vừa có người khác ngồi — chọn ghế khác.";
    default: return code ? `Chuyển thất bại (${code})` : "Chuyển thất bại";
  }
}

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

  // Deep-link giải: ?tour=<id> khi vào từ cockpit/Hôm nay ("Mở màn Bàn"). Đọc MỘT LẦN (ref) để
  // URL đổi về sau không tự chọn lại → không đè lựa chọn thủ công của người dùng.
  const [searchParams] = useSearchParams();
  const deepLinkTourIdRef = useRef<string | null>(searchParams.get("tour"));

  const tourOptions = useMemo(() => {
    const list = (tournaments ?? []) as unknown as Tournament[];
    const primary = list.filter((t) => LIVEISH_PRIMARY.includes(t.status));
    const base = primary.length > 0 ? primary : list.filter((t) => LIVEISH_FALLBACK.includes(t.status));
    // Giải được deep-link phải chọn được ngay cả khi chưa live (VD giải "test" upcoming): thêm vào đầu.
    const deep = deepLinkTourIdRef.current;
    if (deep && !base.some((t) => t.id === deep)) {
      const match = list.find((t) => t.id === deep);
      if (match) return [match, ...base];
    }
    return base;
  }, [tournaments]);

  // P0-3: auto-select CHỈ khi chưa chọn hoặc giải đã chọn biến mất — không clobber lựa chọn user.
  // Seed từ deep-link (nếu có) thay cho null; giải này nằm trong tourOptions nên guard không đè.
  const [tourId, setTourId] = useState<string | null>(deepLinkTourIdRef.current);
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
  // Floor-A2: giữ identity ghế THẬT (seat_id/player_id/table_id…) để ghi update_seats.
  const [playerReal, setPlayerReal] = useState<MapSeat | null>(null);
  const [receiptData, setReceiptData] = useState<SeatReceiptData | null>(null);
  const openPlayer = (s: MockSeat) => {
    const vm = openVM;
    const tableNo = vm?.mock.tableNo ?? 0;
    const real = vm ? (floor.seatsByTable[vm.raw.table_id] ?? []).find((x) => x.seat_number === s.seat) ?? null : null;
    setOpenNo(null);
    setPlayerReal(real);
    requestAnimationFrame(() => setPlayer({ seat: s, tableNo, chipCount: real?.chip_count }));
  };

  // Floor-A2: Sửa chip → Edge tournament-live-draw update_seats (ungated, mirror EditChipsDialog).
  const saveChip = useCallback(async (newChip: number): Promise<boolean> => {
    if (!playerReal || !tourId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return false; }
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tourId,
          action: "update_seats",
          seats: [{
            seat_id: playerReal.seat_id, player_id: playerReal.player_id, entry_number: playerReal.entry_number,
            table_id: playerReal.table_id, seat_number: playerReal.seat_number, chip_count: newChip,
            is_active: true, player_name: playerReal.player_name,
          }],
        },
      });
      const err = error?.message || (data as { error?: string } | null)?.error;
      if (err) { toast.error(err.includes("permission") || err.includes("denied") ? "Không có quyền sửa chip." : `Sửa chip thất bại: ${err}`); return false; }
      toast.success(`Đã cập nhật chip ${playerReal.player_name || "người chơi"}`);
      floor.reload();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Sửa chip thất bại");
      return false;
    }
  }, [playerReal, tourId, floor]);

  // ── Floor-A1: Thêm người → RPC floor_assign_player_to_seat (gate floorTableOps) ──
  // Floor-B: Loại (💰 ITM). openBust ĐỌC LẠI số người còn + cơ cấu thưởng NGAY khi mở (P0-5, không cache);
  // bustPlayer ghi update_seats is_active:false (đúng FloorTableMapPanel). Server tự ghi hạng/thưởng chính thức.
  const [bustInfo, setBustInfo] = useState<{ loading: boolean; place: number | null; prize: number | null } | null>(null);
  const openBust = useCallback(async () => {
    if (!tourId) return;
    setBustInfo({ loading: true, place: null, prize: null });
    try {
      const [seatsRes, prizeRes] = await Promise.all([
        supabase.functions.invoke("tournament-live-draw", { body: { tournament_id: tourId, action: "get_seats" } }),
        supabase.from("tournament_prizes").select("position, amount").eq("tournament_id", tourId),
      ]);
      const active = (((seatsRes.data as { data?: MapSeat[] } | null)?.data ?? []) as MapSeat[]).filter((x) => x.is_active).length;
      const place = active > 0 ? active : null;   // người vừa loại về hạng = số người còn active lúc này
      const prize = place != null ? (((prizeRes.data ?? []) as { position: number; amount: number }[]).find((p) => p.position === place)?.amount ?? null) : null;
      setBustInfo({ loading: false, place, prize });
    } catch {
      setBustInfo({ loading: false, place: null, prize: null });
    }
  }, [tourId]);
  const bustPlayer = useCallback(async (): Promise<boolean> => {
    if (!playerReal || !tourId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return false; }
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tourId, action: "update_seats",
          seats: [{
            seat_id: playerReal.seat_id, player_id: playerReal.player_id, entry_number: playerReal.entry_number,
            table_id: playerReal.table_id, seat_number: playerReal.seat_number, chip_count: playerReal.chip_count ?? 0,
            is_active: false, player_name: playerReal.player_name,
          }],
        },
      });
      if (error) { toast.error(typeof error === "string" ? error : (error as Error).message ?? "Loại thất bại"); return false; }
      const res = data as { error?: string } | null;
      if (res?.error) { toast.error(`Loại thất bại (${res.error})`); return false; }
      toast.success(`Đã loại ${playerReal.player_name || "người chơi"}`);
      floor.reload();
      return true;
    } catch (e) { toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Loại thất bại"); return false; }
  }, [playerReal, tourId, floor]);

  // Chuyển ghế (move_player_seat). Ghế trống mỗi bàn từ dữ liệu get_seats hiện tại; entry_id KHÔNG
  // có trong get_seats → tra tournament_seats theo seat_id (đúng cách desktop MovePlayerDialog).
  const moveTargets = useMemo(() => floor.tables.map((tb) => {
    const occ = new Set((floor.seatsByTable[tb.table_id] ?? []).filter((x) => x.is_active).map((x) => x.seat_number));
    const freeSeats = Array.from({ length: tb.max_seats }, (_, i) => i + 1).filter((n) => !occ.has(n));
    return { tt_id: tb.tt_id, table_number: tb.table_number, freeSeats };
  }).filter((tb) => tb.freeSeats.length > 0), [floor.tables, floor.seatsByTable]);
  const movePlayer = useCallback(async (toTtId: string, toSeat: number, reason: string): Promise<boolean> => {
    if (!playerReal || !tourId || !user) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return false; }
    try {
      const { data: seatRow, error: seErr } = await supabase.from("tournament_seats")
        .select("entry_id").eq("id", playerReal.seat_id).maybeSingle();
      if (seErr || !seatRow?.entry_id) { toast.error("Không tìm được lượt đăng ký (entry) của người chơi."); return false; }
      const { data, error } = await (supabase.rpc as any)("move_player_seat", {
        p_entry_id: seatRow.entry_id,
        p_to_tournament_table_id: toTtId,
        p_to_seat_number: toSeat,
        p_actor_user_id: user.id,
        p_reason: reason,
      });
      const res = (data ?? null) as { ok?: boolean; error?: string; max_seats?: number } | null;
      if (error || !res?.ok) { toast.error(moveError(res, error?.message)); return false; }
      toast.success(`Đã chuyển ${playerReal.player_name || "người chơi"}`);
      floor.reload();
      return true;
    } catch (e) { toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Chuyển thất bại"); return false; }
  }, [playerReal, tourId, user, floor]);

  // Phiếu (READ-ONLY): tái dùng SeatReceiptDialog desktop (QR + in lại). Mirror FloorTableMapPanel.openReceipt —
  // receiptCode/qrValue = entry_id (tra tournament_seats theo seat_id, fallback seat_id). KHÔNG ghi DB.
  const openReceipt = useCallback(async () => {
    const real = playerReal;
    const tour = selectedTour;
    const tableNo = player?.tableNo ?? null;   // capture đồng bộ trước await (act() gọi close() ngay sau)
    if (!real || !tour) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return; }
    let code = real.seat_id;                    // fallback nếu chưa tra được entry_id
    try {
      const { data } = await supabase.from("tournament_seats").select("entry_id").eq("id", real.seat_id).maybeSingle();
      if (data?.entry_id) code = data.entry_id as string;
    } catch { /* giữ fallback seat_id */ }
    setReceiptData({
      tournamentName: tour.name,
      tournamentDate: (tour as Tournament & { start_time?: string | null }).start_time ?? null,
      playerName: real.player_name || real.player_id.slice(0, 8),
      tableNumber: tableNo,
      seatNumber: real.seat_number,
      receiptCode: code,
      startingStack: real.chip_count,
      qrValue: code,
    });
  }, [playerReal, selectedTour, player]);

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

  // ── Floor-A4: Bốc lại → redraw_tournament, 2 bước preview→confirm (gate floorTableOps) ──
  const [redrawOpen, setRedrawOpen] = useState(false);
  const [redrawMode, setRedrawMode] = useState<RedrawMode>("final_table");
  const [redrawDraw, setRedrawDraw] = useState<CloseDrawMode>("redraw_balanced");
  const [redrawTarget, setRedrawTarget] = useState("");
  const [redrawPhase, setRedrawPhase] = useState<"config" | "preview">("config");
  const [redrawPreview, setRedrawPreview] = useState<RedrawResult | null>(null);
  const [redrawBusy, setRedrawBusy] = useState(false);
  const redrawBusyRef = useRef(false);
  const openRedraw = () => { setRedrawMode("final_table"); setRedrawDraw("redraw_balanced"); setRedrawTarget(""); setRedrawPhase("config"); setRedrawPreview(null); setRedrawOpen(true); };
  const callRedraw = useCallback(async (dryRun: boolean): Promise<RedrawResult | null> => {
    const { data, error } = await (supabase.rpc as any)("redraw_tournament", {
      p_tournament_id: tourId,
      p_mode: redrawMode,
      p_eligible_entry_ids: null,          // 3 chế độ auto — không dùng manual
      p_target_table_count: redrawMode === "table_count_threshold" && redrawTarget.trim() ? Number(redrawTarget) : null,
      p_draw_mode: redrawDraw,
      p_dry_run: dryRun,
    });
    if (error) { toast.error(redrawError(null, error.message)); return null; }
    return (data ?? null) as RedrawResult | null;
  }, [tourId, redrawMode, redrawTarget, redrawDraw]);
  const runRedrawPreview = useCallback(async () => {
    if (redrawMode === "table_count_threshold" && !redrawTarget.trim()) { toast.error("Nhập số bàn đích."); return; }
    if (redrawBusyRef.current) return;
    redrawBusyRef.current = true; setRedrawBusy(true);
    try {
      const r = await callRedraw(true);   // dry_run — KHÔNG ghi
      if (!r) return;
      if (!r.ok) { toast.error(redrawError(r)); return; }
      setRedrawPreview(r); setRedrawPhase("preview");
    } catch (e) { toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Xem trước thất bại"); }
    finally { redrawBusyRef.current = false; setRedrawBusy(false); }
  }, [redrawMode, redrawTarget, callRedraw]);
  const runRedrawConfirm = useCallback(async () => {
    if (redrawBusyRef.current) return;
    redrawBusyRef.current = true; setRedrawBusy(true);
    try {
      const r = await callRedraw(false);  // ghi thật
      if (!r) return;
      if (!r.ok) { toast.error(redrawError(r)); return; }
      toast.success(`Đã bốc lại ${r.moved_count ?? r.moves?.length ?? 0} người`);
      setRedrawOpen(false);
      floor.reload();
    } catch (e) { toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Bốc lại thất bại"); }
    finally { redrawBusyRef.current = false; setRedrawBusy(false); }
  }, [callRedraw, floor]);

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
        <button onClick={() => (ADD_LIVE ? openRedraw() : pending())} disabled={!ADD_LIVE}
          className={cn("ios-press ios-fill flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl text-[15px] font-medium text-[#f2ece6]", !ADD_LIVE && "opacity-50")}>
          <Shuffle className="h-[18px] w-[18px]" /> {ADD_LIVE ? "Bốc lại" : "Cần bật cờ"}
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

      {/* Floor-A4 — Bốc lại: config (chế độ + cách chia) → XEM TRƯỚC (dry_run) → xác nhận (ghi) */}
      <Sheet open={redrawOpen} onOpenChange={(v) => { if (!v && !redrawBusy) setRedrawOpen(false); }}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Bốc lại bàn</SheetTitle></SheetHeader>

          {redrawPhase === "config" ? (
            <div className="mt-3 space-y-3">
              <div>
                <div className="px-1 text-[12px] text-[#9b8e97]">Kiểu bốc lại</div>
                <div className="mt-1.5 space-y-1.5">
                  {([["final_table", "Bốc bàn chung kết (final table)"], ["itm", "Bốc khi vào tiền (ITM)"], ["table_count_threshold", "Gom về số bàn đích"]] as [RedrawMode, string][]).map(([m, label]) => (
                    <button key={m} onClick={() => setRedrawMode(m)}
                      className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[14px]", redrawMode === m ? "bg-[#c9a86a]/15 text-[#f2ece6] ring-1 ring-[#c9a86a]/40" : "ios-fill text-[#9b8e97]")}>
                      <span className={cn("grid h-4 w-4 place-items-center rounded-full border", redrawMode === m ? "border-[#c9a86a] bg-[#c9a86a]" : "border-white/25")} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {redrawMode === "table_count_threshold" && (
                <div>
                  <label className="px-1 text-[12px] text-[#9b8e97]">Số bàn đích</label>
                  <input inputMode="numeric" value={redrawTarget} onChange={(e) => setRedrawTarget(e.target.value.replace(/[^0-9]/g, ""))} placeholder="VD: 4"
                    className="ios-fill mt-1 w-full rounded-xl px-3 py-2.5 text-center font-mono text-[16px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
                </div>
              )}
              <div>
                <div className="px-1 text-[12px] text-[#9b8e97]">Cách chia ghế</div>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {([["redraw_balanced", "Ngẫu nhiên, ưu tiên bàn ít"], ["fill_lowest_table", "Lấp bàn số nhỏ trước"]] as [CloseDrawMode, string][]).map(([m, label]) => (
                    <button key={m} onClick={() => setRedrawDraw(m)}
                      className={cn("ios-press-sm rounded-xl px-2 py-2.5 text-center text-[12.5px]", redrawDraw === m ? "bg-[#c9a86a] text-[#241A08] font-semibold" : "ios-fill text-[#9b8e97]")}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-white/5 px-3 py-2 text-[11px] text-[#7c7079]">Chọn người thủ công (Thủ công) — làm trên máy tính.</div>
              <button disabled={redrawBusy} onClick={runRedrawPreview}
                className="ios-press ios-primary flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold disabled:opacity-40">
                {redrawBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {redrawBusy ? "Đang tính…" : "Xem trước"}
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="ios-card p-3.5">
                <div className="text-[13px] text-[#9b8e97]">Kế hoạch (chưa ghi) — <b className="text-[#f2ece6]">{redrawPreview?.moves?.length ?? 0}</b> người chuyển{(redrawPreview?.tables_to_close?.length ?? 0) > 0 ? `, đóng ${redrawPreview?.tables_to_close?.length} bàn` : ""}</div>
                <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                  {(redrawPreview?.moves ?? []).slice(0, 60).map((m, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-white/6 py-1 text-[13px] last:border-0">
                      <span className="truncate text-[#f2ece6]">{m.player_name ?? "—"}</span>
                      <span className="font-mono text-[#9b8e97]">→ Bàn {m.to_table_number ?? "?"}</span>
                    </div>
                  ))}
                  {(redrawPreview?.moves?.length ?? 0) === 0 && <div className="py-3 text-center text-[13px] text-[#9b8e97]">Không có người cần chuyển.</div>}
                </div>
              </div>
              <div className="flex gap-2">
                <button disabled={redrawBusy} onClick={() => setRedrawPhase("config")} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6] disabled:opacity-40">Quay lại</button>
                <button disabled={redrawBusy} onClick={runRedrawConfirm} className="ios-press flex-[2] flex items-center justify-center gap-2 rounded-2xl bg-rose-500/90 py-3 text-[15px] font-bold text-white disabled:opacity-40">
                  {redrawBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />} {redrawBusy ? "Đang bốc…" : `Xác nhận bốc lại ${redrawPreview?.moves?.length ?? 0} người`}
                </button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* S7 — tap người: hiện danh tính thật. Sửa chip/Chuyển/Loại/Thông tin/Phiếu = NỐI THẬT (read
          hoặc write theo callback tương ứng). pendingNotice chỉ còn cho nút chưa nối (Tạm dừng). */}
      <PlayerActionSheets target={player} onClose={() => { setPlayer(null); setPlayerReal(null); setBustInfo(null); }} pendingNotice={PENDING_NOTICE} onSaveChip={saveChip} onBustPlayer={bustPlayer} onOpenBust={openBust} bustInfo={bustInfo} moveTargets={moveTargets} onMovePlayer={movePlayer} onOpenReceipt={openReceipt} infoLive />

      {/* Phiếu xếp ghế (read-only): QR + in lại, tái dùng nguyên component desktop. */}
      <SeatReceiptDialog open={receiptData !== null} onOpenChange={(v) => { if (!v) setReceiptData(null); }} receipt={receiptData} />
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
