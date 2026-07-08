import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import {
  ChevronLeft, Repeat, Users, Coffee, ArrowRightLeft, History, Lightbulb, QrCode,
  Monitor, LogOut, ArrowRight, Clock, FlagTriangleRight, Loader2, LogIn,
  CalendarDays, CheckCircle2, AlertTriangle, Send, UserPlus,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import {
  useActiveTables, useActiveAssignmentsWithTimeline, useCheckedInDealers,
  useTodayCheckedOutDealers,
  type DealerAttendance, type DealerAssignment,
} from "@/hooks/useDealerSwing";

/**
 * Dealer Swing (mobileOpsV2) — bản NỐI DỮ LIỆU THẬT (reads).
 * Ngữ cảnh CLB qua `useOperatorClubs()` (đúng nguồn desktop DealerSwingDashboard dùng);
 * bàn/dealer/đếm ngược đọc từ các hook thật `useActiveTables` / `useActiveAssignmentsWithTimeline`
 * / `useCheckedInDealers` / `useTodayCheckedOutDealers` (realtime).
 *
 * ⚠️ CÁC NÚT HÀNH ĐỘNG (swing/nghỉ/check-in/check-out/đóng tour) CHƯA nối — bước sau sẽ gắn
 * vào đúng Edge Function/RPC (perform_swing / assign-dealer / manage-break / checkout-dealer)
 * SAU KHI owner xác nhận bảng thật hiển thị đúng (UAT). Hiện bấm chỉ hiện nhắc "đang nối".
 */
const BREAK_PRESETS = [15, 30, 45, 60];
const PILLS = [
  { key: "tables", label: "Bàn" },
  { key: "dealers", label: "Dealer" },
  { key: "schedule", label: "Lịch" },
  { key: "requests", label: "Yêu cầu" },
  { key: "staff", label: "Nhân sự" },
  { key: "close", label: "Kết ca" },
] as const;
type Pill = (typeof PILLS)[number]["key"];

type EnrichedAssignment = DealerAssignment & {
  minutesLeft: number | null;
  secondsLeft: number | null;
  showNextDealerSoon: boolean;
  isOverdue: boolean;
  pre_assigned?: {
    dealers?: { full_name?: string | null } | null;
  } | null;
};

/** Target cho break picker — cần attendance_id + club_id (edge manage-break yêu cầu). */
type BreakTarget = { attendanceId: string; clubId: string; name: string };

/** Dealer đủ điều kiện check-in (mirror loadCheckinDealers desktop). */
type CheckinDealer = { id: string; full_name: string; tier: string; wasCheckedOut: boolean };

const hhmm = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—";

const DEALER_CHIP: Record<string, { label: string; cls: string }> = {
  assigned: { label: "Đang bàn", cls: "bg-sky-400/12 text-sky-300" },
  available: { label: "Sẵn sàng", cls: "bg-emerald-400/12 text-emerald-300" },
  on_break: { label: "Nghỉ", cls: "bg-white/6 text-[#9b8e97]" },
  pre_assigned: { label: "Sắp vào", cls: "bg-pink-400/12 text-pink-300" },
  checked_out: { label: "Đã về", cls: "bg-white/6 text-[#7c7079]" },
};

type ScheduleTone = "ok" | "warn" | "danger" | "final" | "info";

const toneCls: Record<ScheduleTone, string> = {
  ok: "bg-emerald-400/12 text-emerald-300",
  warn: "bg-amber-400/12 text-amber-300",
  danger: "bg-rose-400/12 text-rose-300",
  final: "bg-pink-400/12 text-pink-300",
  info: "bg-sky-400/12 text-sky-300",
};

const toneTextCls: Record<ScheduleTone, string> = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  danger: "text-rose-300",
  final: "text-pink-300",
  info: "text-sky-300",
};

const SCHEDULE_DAYS = [
  { label: "T2", day: "06", status: "normal" },
  { label: "T3", day: "07", status: "active" },
  { label: "T4", day: "08", status: "issue" },
  { label: "T5", day: "09", status: "normal" },
  { label: "T6", day: "10", status: "normal" },
  { label: "T7", day: "11", status: "issue" },
  { label: "CN", day: "12", status: "normal" },
] as const;

const SCHEDULE_STATS = [
  { label: "dealer đi làm", value: "18", tone: "ok" as const },
  { label: "lượt ca cần", value: "21", tone: "info" as const },
  { label: "thiếu người", value: "3", tone: "danger" as const },
  { label: "xin nghỉ/đổi", value: "2", tone: "warn" as const },
];

const SHIFT_BLOCKS = [
  {
    id: "early",
    label: "Ca sớm",
    from: "12:00",
    to: "18:00",
    need: 7,
    assigned: 7,
    note: "7 cần · 7 đã xếp · 1 dealer final",
    tags: [
      { label: "Đủ", tone: "ok" as const },
      { label: "Lan final", tone: "final" as const },
    ],
  },
  {
    id: "night",
    label: "Ca tối",
    from: "18:00",
    to: "02:00",
    need: 11,
    assigned: 8,
    note: "11 cần · 8 đã xếp · thiếu bàn 12/15/20",
    tags: [
      { label: "Thiếu 3", tone: "danger" as const },
      { label: "OT cao", tone: "warn" as const },
    ],
  },
] as const;

const TIMELINE_BLOCKS = [
  {
    time: "18:00",
    title: "Mở ca tối",
    note: "Cần 6 dealer bắt đầu ca · 5 đã có mặt",
    dealers: [
      { name: "Minh", detail: "B7" },
      { name: "Hoa", detail: "B8" },
      { name: "Tú", detail: "B9" },
      { name: "Trang", detail: "B10" },
      { name: "Vy", detail: "B11" },
      { name: "+ thiếu", detail: "B12", empty: true },
    ],
  },
  {
    time: "20:30",
    title: "Swing wave 1",
    note: "4 bàn tới giờ thay · ưu tiên dealer đã nghỉ đủ",
    dealers: [
      { name: "Quang", detail: "vào B8" },
      { name: "Hằng", detail: "vào B10" },
      { name: "+ chọn", detail: "B12", empty: true },
    ],
  },
  {
    time: "21:30",
    title: "Final table",
    note: "Cần dealer chỉ định · không tự thay người",
    dealers: [
      { name: "Lan", detail: "Final", final: true },
      { name: "+ backup", detail: "dự phòng", empty: true },
    ],
  },
] as const;

const REQUESTS = [
  {
    initials: "Q",
    title: "Quang xin ca tối",
    note: "Ưu tiên 18:00-02:00 · đang rảnh · phù hợp bàn thường",
    status: "Có thể xếp",
    statusTone: "ok" as const,
    tags: [
      { label: "khớp nhu cầu", tone: "ok" as const },
      { label: "Telegram linked", tone: "info" as const },
    ],
    primary: "Duyệt & xếp",
    secondary: "Để sau",
  },
  {
    initials: "L",
    title: "Lan xin nghỉ 20:00",
    note: "Lan đang được pin chia final 21:30 · cần người thay có quyền final",
    status: "Đụng final",
    statusTone: "danger" as const,
    tags: [
      { label: "final pinned", tone: "final" as const },
      { label: "không auto thay", tone: "danger" as const },
    ],
    primary: "Tìm người thay",
    secondary: "Từ chối",
  },
  {
    initials: "T",
    title: "Tùng đổi ca với Hằng",
    note: "Tùng muốn ca sớm · Hằng đồng ý trong app lúc 11:20",
    status: "Cần xác nhận",
    statusTone: "warn" as const,
    tags: [
      { label: "swap pair", tone: "info" as const },
      { label: "không thiếu ca", tone: "ok" as const },
    ],
    primary: "Duyệt đổi",
    secondary: "Xem chi tiết",
  },
] as const;

const CANDIDATES = [
  { name: "Quang", score: 96, note: "Đã nghỉ 43p · ưu tiên ca tối · Telegram linked", tags: ["best fit", "sẵn sàng"], locked: false },
  { name: "Hằng", score: 88, note: "Đang free · có thể vào ngay · chưa linked app", tags: ["free", "app chưa link"], locked: false },
  { name: "Lan", score: 72, note: "Được pin final 21:30 · không nên dùng cho bàn thường", tags: ["final pinned", "rủi ro"], locked: true },
] as const;

export default function OpsDealerSwing() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { loading: clubsLoading, user, clubs, clubIds, dealerClubIds } = useOperatorClubs();
  const scopedIds = dealerClubIds.length > 0 ? dealerClubIds : clubIds;

  const tablesQ = useActiveTables(scopedIds);
  const asgQ = useActiveAssignmentsWithTimeline(scopedIds);
  const rosterQ = useCheckedInDealers(scopedIds);
  const outQ = useTodayCheckedOutDealers(scopedIds);

  const [pill, setPill] = useState<Pill>("tables");
  const [tableSheet, setTableSheet] = useState<TableVM | null>(null);
  const [dealerSheet, setDealerSheet] = useState<DealerAttendance | null>(null);
  const [pickFor, setPickFor] = useState<TableVM | null>(null);
  const [breakFor, setBreakFor] = useState<BreakTarget | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [schedulePickOpen, setSchedulePickOpen] = useState(false);
  const [placeFor, setPlaceFor] = useState<DealerAttendance | null>(null);   // đưa dealer này vào 1 bàn
  const [checkinList, setCheckinList] = useState<CheckinDealer[] | null>(null); // null = chưa tải
  const [checkinSel, setCheckinSel] = useState<Set<string>>(new Set());
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [fixTable, setFixTable] = useState<TableVM | null>(null);              // sửa nhầm bàn: chọn dealer thật ở bàn này
  const [tourList, setTourList] = useState<{ id: string; clubId: string; name: string }[] | null>(null);
  const [tourToClose, setTourToClose] = useState<string | null>(null);
  const [dongTour, setDongTour] = useState("");
  const [checkout, setCheckout] = useState<Set<string>>(new Set());

  const assignments = useMemo(() => (asgQ.data ?? []) as EnrichedAssignment[], [asgQ.data]);
  const roster = useMemo(() => rosterQ.data ?? [], [rosterQ.data]);

  // table_id → assignment (with timeline)
  const asgByTable = useMemo(() => {
    const m = new Map<string, EnrichedAssignment>();
    for (const a of assignments) m.set(a.table_id, a);
    return m;
  }, [assignments]);
  // attendance_id → table name (dealer đang ở bàn nào)
  const tableByAttendance = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assignments) if (a.attendance_id) m.set(a.attendance_id, a.game_tables?.table_name ?? "");
    return m;
  }, [assignments]);

  const tableVMs = useMemo<TableVM[]>(() => {
    const open = (tablesQ.data ?? []).filter((t) => (t.status ?? "active") !== "inactive");
    return open.map((t) => {
      const a = asgByTable.get(t.id);
      const dealer = a?.dealer_attendance?.dealers?.full_name ?? null;
      const next = a?.pre_assigned?.dealers?.full_name ?? null;
      return {
        id: t.id, clubId: t.club_id, name: t.table_name, assignment: a ?? null,
        dealer, next, missing: !a,
        since: a ? hhmm(a.assigned_at) : "—",
      };
    }).sort((x, y) => rank(x) - rank(y));
  }, [tablesQ.data, asgByTable]);

  const staff = useMemo(() => {
    const byState = { assigned: 0, available: 0, on_break: 0, pre_assigned: 0 };
    for (const d of roster) byState[d.current_state as keyof typeof byState] = (byState[d.current_state as keyof typeof byState] ?? 0) + 1;
    return { openTables: tableVMs.length, inShift: roster.length, ...byState };
  }, [roster, tableVMs.length]);

  const go = <T,>(setter: (v: T) => void, v: T) => { setTableSheet(null); setDealerSheet(null); requestAnimationFrame(() => setter(v)); };
  const soon = () => { setTableSheet(null); setDealerSheet(null); setPickFor(null); setBreakFor(null); setCheckinOpen(false); setSchedulePickOpen(false); toast("Nút này đang được nối — sẽ bật sau khi anh xác nhận bảng thật đúng (UAT)"); };

  // ── Nối hành động THẬT (gate opsSwingActions). Cờ OFF → mọi nút giữ nhắc "đang nối"
  // (soon), 0 gọi RPC/edge. Handlers mirror desktop DealerSwingTab 1:1 (perform_swing /
  // assign-dealer / manage-break / checkout-dealer) — cùng server, cùng RLS. ──
  const LIVE = FEATURES.opsSwingActions;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const reloadAll = () => { tablesQ.refetch(); asgQ.refetch(); rosterQ.refetch(); outQ.refetch(); };
  const runAction = async (fn: () => Promise<void>) => {
    if (!LIVE) { soon(); return; }                 // chưa bật cờ → stub
    if (busyRef.current) return;                   // chống double-tap (ref đồng bộ)
    busyRef.current = true; setBusy(true);
    try { await fn(); } catch (e: any) { toast.error(e?.message ?? "Lỗi mạng"); } finally { busyRef.current = false; setBusy(false); }
  };

  // Swing 1 bàn → RPC perform_swing (mirror performSwingForTable)
  const doSwing = (t: TableVM) => runAction(async () => {
    const asgId = t.assignment?.id;
    if (!asgId) { toast.error("Bàn chưa có lượt để swing."); return; }
    const { data, error } = await (supabase.rpc as any)("perform_swing", { p_assignment_id: asgId });
    if (error) { toast.error(`Lỗi swing: ${error.message}`); return; }
    const outcome = (data as any)?.outcome;
    if (outcome === "no_dealer" || outcome === "no_dealer_available") toast.warning("Không đủ dealer khả dụng để thay.");
    else if (outcome === "race_lost" || outcome === "version_conflict" || outcome === "not_found" || outcome === "state_mismatch") toast.warning("Bàn vừa được xử lý — đang cập nhật.");
    else toast.success("Swing thành công!");
    setTableSheet(null);
    reloadAll();
  });

  // Gán 1 dealer cụ thể vào bàn → edge assign-dealer force_dealer_id (mirror confirmAssign)
  const doAssign = (t: TableVM, d: DealerAttendance) => runAction(async () => {
    const { data, error } = await supabase.functions.invoke("assign-dealer", {
      body: { table_id: t.id, force_dealer_id: d.dealer_id, requested_by: user?.id, idempotency_key: crypto.randomUUID() },
    });
    if (error) {
      let detail = error.message;
      if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        if (error.context.status === 409) { toast.info("Bàn đã có dealer — đang cập nhật."); setPickFor(null); reloadAll(); return; }
        detail = body?.error ?? body?.message ?? detail;
      }
      toast.error(`Lỗi gán: ${detail}`); return;
    }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success(`Đã gán ${d.dealers?.full_name ?? "dealer"} → ${t.name}`);
    setPickFor(null);
    reloadAll();
  });

  // Cho nghỉ → edge manage-break start (mirror sendToBreak). Server kiểm luật nghỉ 15p.
  const doBreak = (target: BreakTarget, minutes: number) => runAction(async () => {
    const { data, error } = await supabase.functions.invoke("manage-break", {
      body: { attendance_id: target.attendanceId, action: "start", requested_by: user?.id, club_id: target.clubId, duration_minutes: minutes, idempotency_key: crypto.randomUUID() },
    });
    if (error) {
      let eb: any = null;
      if (error instanceof FunctionsHttpError) { try { eb = await error.context?.json?.(); } catch { /* ignore */ } }
      toast.error(eb?.error ?? error.message); return;
    }
    const res = data as any;
    if (res?.action === "extended") toast.success(`Đã gia hạn nghỉ ${target.name}, tổng ${res.break_minutes ?? minutes} phút`);
    else toast.success(`Đã cho ${target.name} nghỉ ${minutes} phút`);
    setBreakFor(null);
    reloadAll();
  });

  // Check-out 1 dealer → edge checkout-dealer (mirror doCheckout)
  const doCheckoutOne = (d: DealerAttendance) => runAction(async () => {
    const { data, error } = await supabase.functions.invoke("checkout-dealer", { body: { attendance_id: d.id } });
    if (error) {
      let detail = error.message || "Lỗi check-out";
      try { const ctx = (error as any)?.context; if (ctx?.json) { const b = await ctx.json(); if (b?.error) detail = b.error; } } catch { /* ignore */ }
      toast.error(detail); return;
    }
    if ((data as any)?.released_pre_assigned) toast.warning(`Dealer đang pre-assign bàn ${(data as any).pre_assigned_table ?? "?"} được release`);
    toast.success(`Đã check-out ${d.dealers?.full_name ?? "dealer"}`);
    setDealerSheet(null);
    reloadAll();
  });

  // Check-out hàng loạt → edge checkout-dealer attendance_ids (mirror doBatchCheckout)
  const doBatchCheckout = (ids: string[]) => runAction(async () => {
    if (!ids.length) return;
    const { data, error } = await supabase.functions.invoke("checkout-dealer", { body: { attendance_ids: ids } });
    if (error) {
      let detail = error.message || "Lỗi checkout hàng loạt";
      try { const ctx = (error as any)?.context; if (ctx?.json) { const b = await ctx.json(); if (b?.error) detail = b.error; } } catch { /* ignore */ }
      toast.error(detail); return;
    }
    const results = (data as any)?.results ?? [];
    const ok = results.filter((r: any) => r.success).length;
    if (ok > 0) toast.success(`Đã check-out ${ok}/${ids.length} dealer`);
    if (ok < ids.length) toast.error(`${ids.length - ok} dealer thất bại`);
    setCheckout(new Set());
    reloadAll();
  });

  // Tải danh sách dealer đủ điều kiện check-in (mirror loadCheckinDealers desktop; read-only)
  const loadCheckin = async () => {
    setCheckinLoading(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data: activeDealers } = await supabase.from("dealers")
        .select("id, full_name, tier, club_id").in("club_id", scopedIds).eq("status", "active").order("full_name");
      const map = new Map<string, { id: string; full_name: string; tier: string }>();
      for (const d of activeDealers ?? []) map.set(d.id, { id: d.id, full_name: d.full_name, tier: d.tier });
      const dealerIds = [...map.keys()];
      if (!dealerIds.length) { setCheckinList([]); return; }
      // loại dealer đang checked-in / đang ở bàn
      const { data: activeAtt } = await supabase.from("dealer_attendance").select("dealer_id")
        .in("dealer_id", dealerIds).eq("status", "checked_in").in("current_state", ["available", "assigned", "on_break", "pre_assigned"]);
      const skip = new Set((activeAtt ?? []).map((a) => a.dealer_id));
      const { data: activeAssigns } = await supabase.from("dealer_assignments").select("dealer_id").eq("status", "assigned").in("dealer_id", dealerIds);
      for (const a of activeAssigns ?? []) skip.add(a.dealer_id);
      // phân loại: checked-out hôm nay → re-check-in; chưa có attendance → mới
      const { data: todayAtt } = await supabase.from("dealer_attendance").select("dealer_id, status").eq("shift_date", today).in("dealer_id", dealerIds);
      const checkedOut = new Set((todayAtt ?? []).filter((a) => a.status === "checked_out").map((a) => a.dealer_id));
      const withAtt = new Set((todayAtt ?? []).map((a) => a.dealer_id));
      const out: CheckinDealer[] = [];
      for (const id of dealerIds) {
        if (skip.has(id)) continue;
        const d = map.get(id)!;
        if (checkedOut.has(id)) out.push({ ...d, wasCheckedOut: true });
        else if (!withAtt.has(id)) out.push({ ...d, wasCheckedOut: false });
      }
      setCheckinList(out);
    } catch (e: any) { toast.error(e?.message ?? "Lỗi tải danh sách"); setCheckinList([]); }
    finally { setCheckinLoading(false); }
  };

  // Check-in các dealer đã chọn → INSERT dealer_attendance (mirror doCheckin desktop; giữ lịch sử)
  const doCheckin = (ids: string[]) => runAction(async () => {
    if (!ids.length) return;
    const today = new Date().toISOString().split("T")[0];
    const { data: shifts } = await supabase.from("dealer_shifts").select("id").in("club_id", scopedIds).order("start_time").limit(1);
    const shiftId = (shifts ?? [])[0]?.id ?? null;
    let ok = 0, fail = 0;
    for (const dealerId of ids) {
      const { data: active } = await supabase.from("dealer_attendance").select("id")
        .eq("dealer_id", dealerId).eq("shift_date", today).eq("status", "checked_in").maybeSingle();
      if (active) { ok++; continue; }               // idempotency: đã check-in
      const { error } = await supabase.from("dealer_attendance").insert({
        dealer_id: dealerId, shift_id: shiftId, shift_date: today, status: "checked_in",
        current_state: "available", check_in_time: new Date().toISOString(),
      });
      if (error) { if (error.code === "23505") { ok++; continue; } fail++; continue; }  // 23505 = đã check-in đồng thời
      ok++;
    }
    if (fail > 0) toast.warning(`Check-in: ${ok} thành công, ${fail} thất bại`);
    else toast.success(`Đã check-in ${ok} dealer`);
    setCheckinOpen(false); setCheckinSel(new Set()); setCheckinList(null);
    reloadAll();
  });

  // Tải danh sách tour (dealer_shifts) để chọn tour đóng (mirror useTours desktop; read-only)
  const loadTours = async () => {
    const { data } = await supabase.from("dealer_shifts").select("id, club_id, tour_name").in("club_id", scopedIds).order("start_time");
    setTourList((data ?? []).map((t: any) => ({ id: t.id, clubId: t.club_id, name: t.tour_name ?? "Tour" })));
  };

  // Đóng tour → RPC archive_and_close_dealer_tour (mirror closeTour desktop; lưu trữ + trả bàn)
  const doCloseTour = (tour: { id: string; clubId: string; name: string }) => runAction(async () => {
    const { data, error } = await (supabase.rpc as any)("archive_and_close_dealer_tour", { p_tour_id: tour.id, p_club_id: tour.clubId });
    if (error) { toast.error(`Đóng tour thất bại: ${error.message}`); return; }
    const r = data as any;
    if (!r?.ok) {
      const m: Record<string, string> = { permission_denied: "Không có quyền đóng tour này.", tour_not_found: "Không tìm thấy tour." };
      toast.error(m[r?.outcome] ?? `Đóng tour thất bại: ${r?.outcome ?? "lỗi"}`); return;
    }
    if (r.outcome === "already_closed") toast.info("Tour đã đóng trước đó.");
    else toast.success(`Đã đóng tour ${tour.name} · giải phóng ${r.tables_released ?? 0} bàn · ${r.dealers_released ?? 0} dealer về pool`);
    setDongTour(""); setTourToClose(null); setTourList(null);
    reloadAll();
  });

  // Sửa nhầm bàn → RPC reconcile_dealer_room_state (mirror CorrectWrongTableDealerModal: dry-run → apply
  // với CAS plan). Mặc định điện thoại: effective=bây giờ, swap-về-gốc, displaced→pool, KHÔNG admin-override
  // (sửa quá 120 phút phải làm trên máy tính). Server-authoritative + ghi audit.
  const doFixWrongTable = (table: TableVM, actual: DealerAttendance) => runAction(async () => {
    const tableId = table.id, clubId = table.clubId;
    const recordedBId = table.assignment?.attendance_id ?? null;   // dealer đang ĐƯỢC GHI ở bàn này (B)
    const actualId = actual.id;                                     // dealer THẬT ở bàn này (A)
    if (recordedBId === actualId) { toast.info("Dealer này đã đúng bàn — không cần sửa."); setFixTable(null); return; }
    const aAt = assignments.find((a) => a.attendance_id === actualId && a.table_id !== tableId); // A đang ghi ở bàn khác?
    const reason = "Dealer vào nhầm bàn (sửa từ điện thoại)";
    const build = () => {
      const corrections: any[] = [{ table_id: tableId, actual_attendance_id: actualId }];
      const displaced: any[] = [];
      if (aAt) {
        if (recordedBId && recordedBId !== actualId) corrections.push({ table_id: aAt.table_id, actual_attendance_id: recordedBId });
        else corrections.push({ table_id: aAt.table_id, actual_attendance_id: null, confirm_empty: true });
      } else if (recordedBId && recordedBId !== actualId) {
        displaced.push({ attendance_id: recordedBId, resolution: "pool_available", reason });
      }
      return { corrections, displaced };
    };
    const call = async (dryRun: boolean, plan: any[] | null) => {
      const { corrections, displaced } = build();
      if (plan) for (const c of corrections) {
        const p = plan.find((r: any) => r.table_id === c.table_id);
        if (p?.expected_assignment_id) c.expected_assignment_id = p.expected_assignment_id;
        if (p?.expected_version != null) c.expected_version = p.expected_version;
      }
      const { data, error } = await (supabase as any).rpc("reconcile_dealer_room_state", {
        p_club_id: clubId, p_corrections: corrections, p_effective_at: new Date().toISOString(),
        p_reason: reason, p_displaced: displaced, p_dry_run: dryRun, p_admin_override: false,
      });
      if (error) throw new Error(error.message);
      return data as any;
    };
    const dry = await call(true, null);
    if (dry?.outcome === "noop") { toast.info("Hệ thống đã khớp thực tế — không cần sửa."); setFixTable(null); return; }
    if (dry?.outcome !== "dry_run" || !dry?.can_apply) {
      const m: Record<string, string> = {
        dealer_not_checked_in: "Dealer này chưa check-in.", effective_at_too_old: "Quá 120 phút — sửa trên máy tính (cần quyền admin).",
        forbidden: "Không có quyền sửa bàn cho CLB này.", override_forbidden: "Chỉ admin sửa quá 120 phút.",
      };
      toast.error(m[dry?.outcome] ?? `Không sửa được: ${dry?.detail ?? dry?.outcome ?? "xung đột trạng thái"}`); return;
    }
    const r = await call(false, dry.plan ?? null);
    if (r?.outcome === "applied") {
      const s = r.summary ?? {};
      toast.success(`Đã sửa nhầm bàn ${table.name}`, { description: `Chuyển: ${s.moved ?? 0} · Gán: ${s.assigned ?? 0} · Giải phóng: ${s.released ?? 0}` });
    } else if (r?.outcome === "noop") toast.info("Không cần sửa.");
    else if (r?.outcome === "race_lost") toast.warning("Trạng thái phòng vừa đổi — thử lại.");
    else toast.error(`Sửa thất bại: ${r?.outcome ?? "lỗi"}`);
    setFixTable(null);
    reloadAll();
  });

  // ---- guards (ordered: auth → login → clubs → permission) ----
  if (clubsLoading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải…" sub="Kiểm tra đăng nhập." onBack={() => navigate("/")} />;
  if (!user) return <Guard icon={<LogIn className="h-8 w-8 text-[#c9a86a]" />} title="Cần đăng nhập" sub="Đăng nhập tài khoản có quyền dealer để xem bảng xoay ca thật." onBack={() => navigate("/")} />;
  if (clubs === null) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải bảng…" sub="Lấy dữ liệu câu lạc bộ." onBack={() => navigate("/")} />;
  if (scopedIds.length === 0 && !isAdmin) return <Guard icon={<Users className="h-8 w-8 text-amber-300" />} title="Chưa được phân công CLB" sub="Liên hệ quản trị để được gán quyền điều phối dealer." onBack={() => navigate("/")} />;

  const clubName = clubs && clubs.length ? clubs.map((c) => c.name).join(", ") : "Toàn quyền";

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight text-[#f2ece6]">Dealer Swing</h1>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">{clubName} · việc gấp tự nổi lên đầu</p>
      </header>

      {LIVE ? (
        <div className="rounded-xl bg-emerald-400/8 px-3 py-2 text-[12px] text-emerald-300/90">
          Nút <b>swing · gán · nghỉ · đưa vào bàn · check-in · check-out · sửa nhầm bàn · đóng tour</b> đã bật (dữ liệu thật).
        </div>
      ) : (
        <div className="rounded-xl bg-amber-400/8 px-3 py-2 text-[12px] text-amber-300/90">
          Dữ liệu <b>thật</b>. Các nút hành động đang được nối — bấm sẽ nhắc; sẽ bật sau khi anh xác nhận bảng đúng.
        </div>
      )}

      <div className="flex gap-1.5 overflow-x-auto px-1 pb-1">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => { setPill(p.key); if (p.key === "close") loadTours(); }}
            className={cn("ios-press-sm shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
            {p.label}
          </button>
        ))}
      </div>

      {/* D1 — Bàn + đếm ngược (thật) */}
      {pill === "tables" && (
        <div className="space-y-3">
          <div className="ios-card flex items-center justify-between px-4 py-3 text-[13px]">
            <span><span className="text-sky-300">{staff.assigned} đang bàn</span> · <span className="text-[#9b8e97]">{staff.on_break} nghỉ</span></span>
            {tableVMs.some((t) => t.missing) && <span className="rounded-full bg-rose-400/12 px-2 py-0.5 text-[11px] font-semibold text-rose-300">thiếu {tableVMs.filter((t) => t.missing).length}</span>}
          </div>
          {tableVMs.length === 0 ? (
            <Empty text="Chưa có bàn nào đang mở." />
          ) : (
            <div className="ios-group">
              {tableVMs.map((t) => {
                const c = countdown(t);
                return (
                  <button key={t.id} onClick={() => setTableSheet(t)}
                    className={cn("ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left", (t.missing || t.assignment?.isOverdue) && "bg-rose-500/6")}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] text-[#f2ece6]">{t.name} <span className="text-[#9b8e97]">· {t.dealer ?? "—"}</span></span>
                      <span className="block text-[12px] text-[#9b8e97]">{t.missing ? "chưa có dealer" : t.next ? `kế tiếp: ${t.next}` : `vào ${t.since}`}</span>
                    </span>
                    {t.missing
                      ? <span className="rounded-full bg-rose-400/12 px-2.5 py-1 text-[11px] font-semibold text-rose-300">Gán ngay</span>
                      : <span className={cn("text-[13px] font-semibold tabular-nums", c.cls)}>{c.text}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* D3 — Dealer pool (thật) */}
      {pill === "dealers" && (
        roster.length === 0 ? <Empty text="Chưa có dealer nào trong ca." /> : (
          <div className="ios-group">
            {roster.map((d) => {
              const chip = DEALER_CHIP[d.current_state] ?? DEALER_CHIP.available;
              const table = tableByAttendance.get(d.id);
              return (
                <button key={d.id} onClick={() => setDealerSheet(d)}
                  className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-[#f2ece6]">{d.dealers?.full_name ?? "—"}</span>
                    <span className="block text-[12px] tabular-nums text-[#9b8e97]">vào ca {hhmm(d.check_in_time)}{table ? ` · ${table}` : ""}{d.current_state === "on_break" ? " · đang nghỉ" : ""}</span>
                  </span>
                  <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", chip.cls)}>{chip.label}</span>
                </button>
              );
            })}
          </div>
        )
      )}

      {/* D4a — Lịch dealer swing (UI mobile mock, không đổi logic xếp ca) */}
      {pill === "schedule" && (
        <div className="space-y-3">
          <div className="ios-card overflow-hidden p-4">
            <div className="flex items-start justify-between gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#c9a86a]/12 text-[#c9a86a]">
                <CalendarDays className="h-5 w-5" />
              </span>
              <span className="rounded-full bg-emerald-400/12 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">mobile draft</span>
            </div>
            <h2 className="mt-3 text-[18px] font-semibold leading-tight text-[#f2ece6]">Lịch Dealer Swing</h2>
            <p className="mt-1 text-[13px] leading-5 text-[#9b8e97]">Bản UI mobile để floor xem coverage, thiếu ca, final table và yêu cầu đổi lịch trong cùng một luồng.</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {SCHEDULE_STATS.map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/8 bg-black/20 px-2.5 py-2">
                  <div className={cn("text-[20px] font-bold leading-none tabular-nums", toneTextCls[stat.tone])}>{stat.value}</div>
                  <div className="mt-1 min-h-[26px] text-[10.5px] font-medium leading-[13px] text-[#91a49b]">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="ios-card p-3.5">
            <SectionLabel>Tuần này</SectionLabel>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
              {SCHEDULE_DAYS.map((day) => (
                <button
                  key={`${day.label}-${day.day}`}
                  onClick={soon}
                  className={cn(
                    "ios-press-sm rounded-2xl border px-1.5 py-2 text-center",
                    day.status === "active" && "border-[#c9a86a]/60 bg-[#c9a86a]/15 text-[#f2ece6]",
                    day.status === "issue" && "border-rose-400/30 bg-rose-400/10 text-rose-200",
                    day.status === "normal" && "border-white/8 bg-white/[0.035] text-[#9b8e97]",
                  )}
                >
                  <span className="block text-[10px] font-semibold uppercase leading-none">{day.label}</span>
                  <span className="mt-1 block text-[15px] font-semibold leading-none tabular-nums">{day.day}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="ios-card p-3.5">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>Coverage theo ca</SectionLabel>
              <span className="rounded-full bg-rose-400/12 px-2 py-0.5 text-[11px] font-semibold text-rose-300">thiếu 3</span>
            </div>
            <div className="mt-3 space-y-2.5">
              {SHIFT_BLOCKS.map((shift) => {
                const pct = Math.min(100, Math.round((shift.assigned / shift.need) * 100));
                const isShort = shift.assigned < shift.need;
                return (
                  <div key={shift.id} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold text-[#f2ece6]">{shift.label}</div>
                        <div className="mt-0.5 text-[12px] leading-4 text-[#9b8e97]">{shift.note}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={cn("text-[18px] font-bold leading-none tabular-nums", isShort ? "text-rose-300" : "text-emerald-300")}>{shift.assigned}/{shift.need}</div>
                        <div className="mt-1 text-[10px] font-medium text-[#6f8078]">{shift.from}-{shift.to}</div>
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
                      <div className={cn("h-full rounded-full", isShort ? "bg-rose-400" : "bg-[#c9a86a]")} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {shift.tags.map((tag) => <ToneChip key={tag.label} label={tag.label} tone={tag.tone} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ios-card p-3.5">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>Timeline tối nay</SectionLabel>
              <span className="text-[11px] font-semibold text-[#c9a86a]">18:00-02:00</span>
            </div>
            <div className="mt-3 space-y-3">
              {TIMELINE_BLOCKS.map((block) => (
                <div key={block.time} className="flex gap-3">
                  <div className="w-[48px] shrink-0 text-[14px] font-semibold leading-6 tabular-nums text-[#c9a86a]">{block.time}</div>
                  <div className="min-w-0 flex-1 rounded-2xl border border-white/8 bg-black/18 p-3">
                    <div className="flex items-center gap-2">
                      <div className="text-[15px] font-semibold leading-tight text-[#f2ece6]">{block.title}</div>
                      {block.title.includes("Final") && <ToneChip label="final" tone="final" />}
                    </div>
                    <div className="mt-1 text-[12px] leading-4 text-[#9b8e97]">{block.note}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {block.dealers.map((dealer) => (
                        <button
                          key={`${block.time}-${dealer.name}-${dealer.detail}`}
                          onClick={dealer.empty ? () => setSchedulePickOpen(true) : soon}
                          className={cn(
                            "ios-press-sm rounded-full border px-2.5 py-1.5 text-left",
                            dealer.empty && "border-dashed border-[#c9a86a]/45 bg-[#c9a86a]/10 text-[#c9a86a]",
                            dealer.final && "border-pink-400/30 bg-pink-400/10 text-pink-200",
                            !dealer.empty && !dealer.final && "border-white/8 bg-white/[0.04] text-[#f2ece6]",
                          )}
                        >
                          <span className="block text-[11px] font-semibold leading-none">{dealer.name}</span>
                          <span className="mt-1 block text-[10px] leading-none text-[#91a49b]">{dealer.detail}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setSchedulePickOpen(true)} className="ios-press ios-primary flex min-h-[46px] items-center justify-center gap-2 rounded-2xl px-3 py-3 text-[13px] font-bold">
              <UserPlus className="h-4 w-4" /> Chọn dealer
            </button>
            <button onClick={() => setPill("requests")} className="ios-press ios-fill flex min-h-[46px] items-center justify-center gap-2 rounded-2xl px-3 py-3 text-[13px] font-semibold text-[#f2ece6]">
              <Send className="h-4 w-4 text-[#c9a86a]" /> Yêu cầu
            </button>
          </div>
        </div>
      )}

      {/* D4b — Yêu cầu đổi ca/nghỉ/xin lịch (UI mobile mock, action chưa nối) */}
      {pill === "requests" && (
        <div className="space-y-3">
          <div className="ios-card p-3.5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-400/12 text-amber-300">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-semibold text-[#f2ece6]">Yêu cầu lịch hôm nay</div>
                <div className="mt-1 text-[12px] leading-4 text-[#9b8e97]">Giữ semantic rõ: xanh là có thể xếp, vàng cần xác nhận, đỏ đụng final/thiếu người.</div>
              </div>
            </div>
          </div>

          {REQUESTS.map((request) => (
            <div key={request.title} className="ios-card p-3.5">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#c9a86a]/25 bg-[#c9a86a]/10 text-[15px] font-bold text-[#c9a86a]">{request.initials}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold text-[#f2ece6]">{request.title}</div>
                      <div className="mt-1 text-[12px] leading-4 text-[#9b8e97]">{request.note}</div>
                    </div>
                    <ToneChip label={request.status} tone={request.statusTone} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {request.tags.map((tag) => <ToneChip key={tag.label} label={tag.label} tone={tag.tone} />)}
                  </div>
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    <button onClick={soon} className="ios-press ios-primary min-h-[42px] rounded-2xl px-3 text-[13px] font-bold">{request.primary}</button>
                    <button onClick={soon} className="ios-press ios-fill min-h-[42px] rounded-2xl px-3 text-[13px] font-semibold text-[#f2ece6]">{request.secondary}</button>
                  </div>
                </div>
              </div>
            </div>
          ))}

          <button onClick={() => setPill("schedule")} className="ios-press ios-fill flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-semibold text-[#f2ece6]">
            <CalendarDays className="h-4 w-4 text-[#c9a86a]" /> Quay lại lịch ca
          </button>
        </div>
      )}

      {/* D5 — Nhân sự ca (thật, số đếm) */}
      {pill === "staff" && (
        <div className="space-y-3">
          <div className="ios-card p-4">
            <Line l="Bàn đang mở" v={String(staff.openTables)} />
            <Line l="Dealer trong ca" v={String(staff.inShift)} vCls="text-emerald-300" />
            <Line l="Đang chia bàn" v={String(staff.assigned)} vCls="text-sky-300" />
            <Line l="Đang nghỉ" v={String(staff.on_break)} vCls="text-amber-300" />
            <Line l="Sẵn sàng" v={String(staff.available)} />
          </div>
          <div className="ios-group">
            <button onClick={() => { setCheckinOpen(true); loadCheckin(); }} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <QrCode className="h-5 w-5 text-[#d8bc85]" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Check-in dealer mới</span><span className="block text-[12px] text-[#9b8e97]">chọn từ danh sách dealer đang rảnh</span></span>
            </button>
            <button onClick={() => setPill("schedule")} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <Monitor className="h-5 w-5 text-[#9b8e97]" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Gợi ý điều phối &amp; xếp lịch</span><span className="block text-[12px] text-[#9b8e97]">xem bản mobile trong tab Lịch</span></span>
            </button>
          </div>
        </div>
      )}

      {/* D6 — Kết ca (thật roster) */}
      {pill === "close" && (
        <div className="space-y-3">
          <div className="ios-card p-3.5">
            <div className="text-[15px] font-semibold text-[#f2ece6]">Check-out hàng loạt</div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">chọn dealer đã xong ca</div>
            <div className="mt-2.5 space-y-1">
              {roster.length === 0 ? <div className="py-4 text-center text-[13px] text-[#9b8e97]">Không có dealer đang trong ca.</div> : roster.map((d) => {
                const on = checkout.has(d.id);
                return (
                  <button key={d.id} onClick={() => setCheckout((s) => {
                    const n = new Set(s);
                    if (n.has(d.id)) n.delete(d.id);
                    else n.add(d.id);
                    return n;
                  })}
                    className="ios-press-sm flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left">
                    <span className={cn("grid h-5 w-5 place-items-center rounded-md border", on ? "border-[#c9a86a] bg-[#c9a86a] text-[#241A08]" : "border-white/20 text-transparent")}>✓</span>
                    <span className="flex-1 text-[14px] text-[#f2ece6]">{d.dealers?.full_name ?? "—"}</span>
                    <span className="text-[12px] tabular-nums text-[#9b8e97]">vào {hhmm(d.check_in_time)}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => doBatchCheckout([...checkout])} disabled={checkout.size === 0 || busy}
              className="ios-press ios-fill mt-2.5 w-full rounded-2xl py-2.5 text-[14px] font-medium text-[#f2ece6] disabled:opacity-40">
              Check-out {checkout.size} người đã chọn
            </button>
          </div>
          {(outQ.data ?? []).length > 0 && (
            <div className="ios-card p-3.5">
              <div className="text-[13px] text-[#9b8e97]">Đã check-out hôm nay</div>
              <div className="mt-1.5 space-y-1">
                {(outQ.data ?? []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between py-0.5 text-[14px]">
                    <span className="text-[#9b8e97]">{d.dealers?.full_name ?? "—"}</span>
                    <span className="text-[12px] tabular-nums text-[#7c7079]">ra {hhmm(d.check_out_time)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="ios-card border border-rose-500/20 p-3.5">
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-rose-300"><FlagTriangleRight className="h-4 w-4" /> Đóng tour</div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">chọn tour → gõ DONG TOUR. Lưu trữ toàn bộ ca + trả bàn về trống. Không hoàn tác.</div>
            {tourList === null ? (
              <div className="mt-2.5 text-center text-[12px] text-[#7c7079]">đang tải danh sách tour…</div>
            ) : tourList.length === 0 ? (
              <div className="mt-2.5 text-center text-[12px] text-[#7c7079]">Không có tour nào.</div>
            ) : (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {tourList.map((t) => (
                  <button key={t.id} onClick={() => { setTourToClose(t.id); setDongTour(""); }}
                    className={cn("ios-press-sm rounded-full px-3 py-1.5 text-[12px] font-medium", tourToClose === t.id ? "border border-rose-400/40 bg-rose-500/20 text-rose-200" : "bg-white/5 text-[#9b8e97]")}>
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            {tourToClose && (() => {
              const t = tourList?.find((x) => x.id === tourToClose);
              if (!t) return null;
              return (
                <>
                  <input value={dongTour} onChange={(e) => setDongTour(e.target.value.toUpperCase())} placeholder="gõ  DONG TOUR  để mở khoá"
                    className="ios-fill mt-2.5 w-full rounded-xl px-3 py-2.5 text-center text-[14px] font-semibold tracking-normal text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
                  <button disabled={dongTour.trim() !== "DONG TOUR" || busy} onClick={() => doCloseTour(t)}
                    className={cn("ios-press mt-2.5 w-full rounded-2xl py-3 text-[15px] font-bold", dongTour.trim() === "DONG TOUR" ? "bg-rose-500/90 text-white" : "bg-white/5 text-[#5f545c]")}>
                    Đóng tour {t.name} {dongTour.trim() !== "DONG TOUR" && "(đang khoá)"}
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* D2 — sheet bàn */}
      <Sheet open={tableSheet !== null} onOpenChange={(v) => { if (!v) setTableSheet(null); }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">
              {tableSheet?.name}
              {tableSheet && (tableSheet.missing || tableSheet.assignment?.isOverdue) && <span className="ml-2 rounded-full bg-rose-400/12 px-2 py-0.5 text-[11px] font-semibold text-rose-300">{tableSheet.missing ? "Thiếu dealer" : "OT"}</span>}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-center text-[13px] tabular-nums text-[#9b8e97]">{tableSheet?.dealer ?? "—"} · vào {tableSheet?.since}</div>
          {tableSheet?.next && (
            <div className="ios-card mt-3 flex items-center gap-2 px-3.5 py-2.5 text-[13px]">
              <Lightbulb className="h-4 w-4 text-[#d8bc85]" />
              <span className="text-[#d8bc85]">Kế tiếp theo lịch: <b>{tableSheet.next}</b></span>
            </div>
          )}
          <div className="mt-3 space-y-1.5">
            <button disabled={busy} onClick={() => { if (!tableSheet) return; tableSheet.missing ? go(setPickFor, tableSheet) : doSwing(tableSheet); }}
              className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left disabled:opacity-50">
              <Repeat className="h-5 w-5 shrink-0" />
              <span className="text-[15px] font-bold">{tableSheet?.missing ? "Gán dealer ngay" : `Swing ngay${tableSheet?.next ? ` — ${tableSheet.next} vào thay` : ""}`}</span>
            </button>
            <SheetRow icon={<Users className="h-5 w-5 text-sky-300" />} label="Chọn dealer khác…" onTap={() => go(setPickFor, tableSheet)} />
            {tableSheet?.assignment?.attendance_id && (
              <SheetRow icon={<Coffee className="h-5 w-5 text-amber-300" />} label={`Cho ${tableSheet.dealer ?? "dealer"} nghỉ`}
                onTap={() => go(setBreakFor, { attendanceId: tableSheet.assignment!.attendance_id, clubId: tableSheet.clubId, name: tableSheet.dealer ?? "dealer" })} />
            )}
            <SheetRow icon={<ArrowRightLeft className="h-5 w-5 text-[#9b8e97]" />} label="Sửa nhầm bàn (chọn dealer thật)" onTap={() => tableSheet && go(setFixTable, tableSheet)} />
            <SheetRow icon={<History className="h-5 w-5 text-[#9b8e97]" />} label="Lịch sử bàn này" onTap={soon} />
          </div>
        </SheetContent>
      </Sheet>

      {/* D4 — sheet dealer */}
      <Sheet open={dealerSheet !== null} onOpenChange={(v) => { if (!v) setDealerSheet(null); }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="items-center text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-sky-400 bg-[#241A2C] text-[15px] font-semibold text-sky-300">
              {(dealerSheet?.dealers?.full_name ?? "?").slice(0, 2)}
            </div>
            <SheetTitle className="mt-1.5 text-[16px] font-semibold text-[#f2ece6]">
              {dealerSheet?.dealers?.full_name} {dealerSheet && <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", (DEALER_CHIP[dealerSheet.current_state] ?? DEALER_CHIP.available).cls)}>{(DEALER_CHIP[dealerSheet.current_state] ?? DEALER_CHIP.available).label}</span>}
            </SheetTitle>
            <div className="text-[12px] tabular-nums text-[#9b8e97]">vào ca {hhmm(dealerSheet?.check_in_time)}{dealerSheet && tableByAttendance.get(dealerSheet.id) ? ` · ${tableByAttendance.get(dealerSheet.id)}` : ""}</div>
          </SheetHeader>
          <div className="mt-3 space-y-1.5">
            <button disabled={busy} onClick={() => dealerSheet && go(setPlaceFor, dealerSheet)}
              className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left disabled:opacity-50">
              <ArrowRight className="h-5 w-5 shrink-0" /><span className="text-[15px] font-bold">Đưa vào bàn…</span>
            </button>
            <SheetRow icon={<Coffee className="h-5 w-5 text-amber-300" />} label="Cho nghỉ ưu tiên"
              onTap={() => dealerSheet && go(setBreakFor, { attendanceId: dealerSheet.id, clubId: dealerSheet.dealers.club_id, name: dealerSheet.dealers.full_name })} />
            <SheetRow icon={<Clock className="h-5 w-5 text-[#9b8e97]" />} label="Ca hôm nay — giờ vào/ra, số bàn đã chia" onTap={soon} />
            <SheetRow icon={<LogOut className="h-5 w-5 text-rose-300" />} label={<span className="text-rose-300">Check-out khỏi ca</span>} onTap={() => dealerSheet && doCheckoutOne(dealerSheet)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* P1 — chọn dealer khác (roster sẵn sàng) */}
      <Sheet open={pickFor !== null} onOpenChange={(v) => { if (!v) setPickFor(null); }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Chọn dealer vào {pickFor?.name}</SheetTitle></SheetHeader>
          <div className="ios-group mt-3">
            {roster.filter((d) => d.current_state === "available" || d.current_state === "on_break").length === 0
              ? <div className="px-4 py-6 text-center text-[13px] text-[#9b8e97]">Không có dealer đang rảnh.</div>
              : roster.filter((d) => d.current_state === "available" || d.current_state === "on_break").map((d) => {
                const locked = d.current_state !== "available";
                return (
                  <button key={d.id} disabled={locked || busy} onClick={() => pickFor && doAssign(pickFor, d)}
                    className={cn("ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left", !locked && "ios-press-sm", locked && "opacity-55")}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] text-[#f2ece6]">{d.dealers?.full_name ?? "—"}</span>
                      <span className="block text-[12px] tabular-nums text-[#9b8e97]">vào ca {hhmm(d.check_in_time)}{locked ? " · đang nghỉ" : ""}</span>
                    </span>
                    {locked ? <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] text-[#9b8e97]">nghỉ</span> : <span className="text-[13px] text-[#c9a86a]">chọn</span>}
                  </button>
                );
              })}
          </div>
          <div className="mt-2.5 text-center text-[12px] text-[#7c7079]">luật nghỉ 15p sẽ được server kiểm khi bật nút thật</div>
        </SheetContent>
      </Sheet>

      {/* break picker */}
      <Sheet open={breakFor !== null} onOpenChange={(v) => { if (!v) setBreakFor(null); }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Cho {breakFor?.name} nghỉ</SheetTitle></SheetHeader>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {BREAK_PRESETS.map((m) => (
              <button key={m} disabled={busy} onClick={() => breakFor && doBreak(breakFor, m)} className="ios-press ios-fill rounded-2xl py-3 text-center text-[15px] font-semibold text-[#f2ece6] disabled:opacity-50">{m}p</button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* schedule picker mock */}
      <Sheet open={schedulePickOpen} onOpenChange={setSchedulePickOpen}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">Chọn dealer vào Bàn 12</SheetTitle>
          </SheetHeader>
          <div className="mt-1 text-center text-[12px] leading-4 text-[#9b8e97]">Gợi ý UI theo lịch ca, nghỉ đủ và ràng buộc final. Chưa nối hành động thật.</div>
          <div className="ios-group mt-3">
            {CANDIDATES.map((candidate) => (
              <button
                key={candidate.name}
                disabled={candidate.locked}
                onClick={soon}
                className={cn("ios-row-inset flex w-full items-start gap-3 px-4 py-3 text-left", !candidate.locked && "ios-press-sm", candidate.locked && "opacity-55")}
              >
                <span className={cn("mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full border text-[13px] font-bold", candidate.locked ? "border-pink-400/25 bg-pink-400/10 text-pink-200" : "border-[#c9a86a]/35 bg-[#c9a86a]/12 text-[#c9a86a]")}>
                  {candidate.score}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-[#f2ece6]">{candidate.name}</span>
                  <span className="mt-1 block text-[12px] leading-4 text-[#9b8e97]">{candidate.note}</span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {candidate.tags.map((tag) => (
                      <span key={tag} className={cn(
                        "rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                        tag.includes("rủi") || tag.includes("final") ? "bg-pink-400/12 text-pink-300" : tag.includes("chưa") ? "bg-amber-400/12 text-amber-300" : "bg-emerald-400/12 text-emerald-300",
                      )}>{tag}</span>
                    ))}
                  </span>
                </span>
                <span className={cn("mt-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", candidate.locked ? "bg-white/6 text-[#9b8e97]" : "bg-[#c9a86a]/12 text-[#c9a86a]")}>
                  {candidate.locked ? "khóa" : "chọn"}
                </span>
              </button>
            ))}
          </div>
          <button onClick={soon} className="ios-press ios-primary mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-bold">
            <CheckCircle2 className="h-4 w-4" /> Xác nhận chọn dealer
          </button>
        </SheetContent>
      </Sheet>

      {/* sửa nhầm bàn — chọn dealer THẬT đang ngồi ở bàn này */}
      <Sheet open={fixTable !== null} onOpenChange={(v) => { if (!v) setFixTable(null); }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Ai đang thật sự ở {fixTable?.name}?</SheetTitle></SheetHeader>
          <div className="mt-1 text-center text-[12px] leading-4 text-[#9b8e97]">Hệ thống đang ghi: <b>{fixTable?.dealer ?? "trống"}</b>. Chọn dealer thật đang ngồi — server sẽ sửa + ghi audit.</div>
          <div className="ios-group mt-3 max-h-[46vh] overflow-y-auto">
            {roster.filter((d) => d.dealers?.club_id === fixTable?.clubId).length === 0
              ? <div className="px-4 py-6 text-center text-[13px] text-[#9b8e97]">Không có dealer đang trong ca.</div>
              : roster.filter((d) => d.dealers?.club_id === fixTable?.clubId).map((d) => {
                const isRecorded = fixTable?.assignment?.attendance_id === d.id;
                return (
                  <button key={d.id} disabled={busy} onClick={() => fixTable && doFixWrongTable(fixTable, d)}
                    className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] text-[#f2ece6]">{d.dealers?.full_name ?? "—"}</span>
                      <span className="block text-[12px] text-[#9b8e97]">{DEALER_CHIP[d.current_state]?.label ?? d.current_state}{tableByAttendance.get(d.id) ? ` · ${tableByAttendance.get(d.id)}` : ""}</span>
                    </span>
                    {isRecorded ? <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] text-[#9b8e97]">đang ghi</span> : <span className="text-[13px] text-[#c9a86a]">chọn</span>}
                  </button>
                );
              })}
          </div>
          <div className="mt-2.5 text-center text-[12px] text-[#7c7079]">sửa quá 120 phút hoặc nhiều bàn domino → làm trên máy tính</div>
        </SheetContent>
      </Sheet>

      {/* đưa dealer vào bàn — chọn bàn đang thiếu người */}
      <Sheet open={placeFor !== null} onOpenChange={(v) => { if (!v) setPlaceFor(null); }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Đưa {placeFor?.dealers?.full_name} vào bàn</SheetTitle></SheetHeader>
          <div className="ios-group mt-3">
            {tableVMs.filter((t) => t.missing).length === 0
              ? <div className="px-4 py-6 text-center text-[13px] text-[#9b8e97]">Không có bàn nào đang thiếu dealer.</div>
              : tableVMs.filter((t) => t.missing).map((t) => (
                <button key={t.id} disabled={busy} onClick={() => { const d = placeFor; setPlaceFor(null); if (d) doAssign(t, d); }}
                  className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-[#f2ece6]">{t.name}</span>
                    <span className="block text-[12px] text-rose-300">chưa có dealer</span>
                  </span>
                  <span className="text-[13px] text-[#c9a86a]">chọn</span>
                </button>
              ))}
          </div>
          <div className="mt-2.5 text-center text-[12px] text-[#7c7079]">chỉ hiện bàn đang thiếu dealer · luật nghỉ do server kiểm</div>
        </SheetContent>
      </Sheet>

      {/* P2 — check-in (chọn từ danh sách dealer đủ điều kiện) */}
      <Sheet open={checkinOpen} onOpenChange={(v) => { setCheckinOpen(v); if (!v) { setCheckinSel(new Set()); setCheckinList(null); } }}>
        <SheetContent side="bottom" className="ops-sheet rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Check-in dealer</SheetTitle></SheetHeader>
          <div className="mt-3 grid h-[56px] place-items-center rounded-2xl border border-dashed border-white/12 text-[12px] text-[#7c7079]">
            <span className="flex items-center gap-1.5"><QrCode className="h-4 w-4" /> Quét QR sẽ bổ sung sau — chọn từ danh sách bên dưới</span>
          </div>
          {checkinLoading ? (
            <div className="mt-3 flex items-center justify-center gap-2 py-6 text-[13px] text-[#9b8e97]"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải…</div>
          ) : !checkinList || checkinList.length === 0 ? (
            <div className="mt-3 py-6 text-center text-[13px] text-[#9b8e97]">Không có dealer nào để check-in (tất cả đang trong ca).</div>
          ) : (
            <>
              <div className="ios-group mt-3 max-h-[46vh] overflow-y-auto">
                {checkinList.map((d) => {
                  const on = checkinSel.has(d.id);
                  return (
                    <button key={d.id} onClick={() => setCheckinSel((s) => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })}
                      className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                      <span className={cn("grid h-5 w-5 place-items-center rounded-md border", on ? "border-[#c9a86a] bg-[#c9a86a] text-[#241A08]" : "border-white/20 text-transparent")}>✓</span>
                      <span className="min-w-0 flex-1 text-[15px] text-[#f2ece6]">{d.full_name}</span>
                      {d.wasCheckedOut && <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] text-[#9b8e97]">vào lại</span>}
                      <span className="rounded-full bg-white/6 px-1.5 py-0.5 text-[11px] text-[#9b8e97]">{d.tier}</span>
                    </button>
                  );
                })}
              </div>
              <button disabled={checkinSel.size === 0 || busy} onClick={() => doCheckin([...checkinSel])}
                className="ios-press ios-fill mt-3 w-full rounded-2xl py-3 text-[14px] font-medium text-[#f2ece6] disabled:opacity-40">
                Check-in {checkinSel.size} dealer đã chọn
              </button>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface TableVM {
  id: string; clubId: string; name: string;
  assignment: EnrichedAssignment | null;
  dealer: string | null; next: string | null; missing: boolean; since: string;
}

function rank(t: TableVM) {
  if (t.missing) return -1000;
  if (t.assignment?.isOverdue) return -500;
  return t.assignment?.minutesLeft ?? 9999;
}
function countdown(t: TableVM) {
  const a = t.assignment;
  if (!a || a.minutesLeft == null) return { text: "—", cls: "text-[#9b8e97]" };
  if (a.isOverdue) return { text: "OT", cls: "text-rose-300" };
  const m = Math.floor(a.minutesLeft);
  const s = (a.secondsLeft ?? 0) % 60;
  const cls = m < 5 ? "text-amber-300" : "text-emerald-300";
  return { text: `còn ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, cls };
}

function ToneChip({ label, tone }: { label: string; tone: ScheduleTone }) {
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", toneCls[tone])}>{label}</span>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase leading-none text-[#91a49b]">{children}</div>;
}

function Line({ l, v, vCls }: { l: string; v: string; vCls?: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-[14px]">
      <span className="text-[#9b8e97]">{l}</span>
      <span className={cn("text-[16px] font-semibold tabular-nums", vCls ?? "text-[#f2ece6]")}>{v}</span>
    </div>
  );
}
function SheetRow({ icon, label, onTap }: { icon: React.ReactNode; label: React.ReactNode; onTap: () => void }) {
  return (
    <button onClick={onTap} className="ios-press ios-fill flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
      {icon}<span className="text-[15px] text-[#f2ece6]">{label}</span>
    </button>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="ios-card py-10 text-center text-[14px] text-[#9b8e97]">{text}</div>;
}
function Guard({ icon, title, sub, onBack }: { icon: React.ReactNode; title: string; sub: string; onBack: () => void }) {
  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={onBack} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight text-[#f2ece6]">Dealer Swing</h1>
      </header>
      <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
        {icon}
        <div className="mt-1 text-[16px] font-semibold text-[#f2ece6]">{title}</div>
        <div className="max-w-[260px] text-[13px] text-[#9b8e97]">{sub}</div>
      </div>
    </div>
  );
}
