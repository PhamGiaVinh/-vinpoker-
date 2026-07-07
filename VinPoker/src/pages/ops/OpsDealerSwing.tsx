import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronLeft, Repeat, Users, Coffee, ArrowRightLeft, History, Lightbulb, QrCode,
  Monitor, LogOut, ArrowRight, Clock, FlagTriangleRight, Loader2, LogIn,
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
  { key: "staff", label: "Nhân sự" },
  { key: "close", label: "Kết ca" },
] as const;
type Pill = (typeof PILLS)[number]["key"];

type EnrichedAssignment = DealerAssignment & {
  minutesLeft: number | null;
  secondsLeft: number | null;
  showNextDealerSoon: boolean;
  isOverdue: boolean;
};

const hhmm = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—";

const DEALER_CHIP: Record<string, { label: string; cls: string }> = {
  assigned: { label: "Đang bàn", cls: "bg-sky-400/12 text-sky-300" },
  available: { label: "Sẵn sàng", cls: "bg-emerald-400/12 text-emerald-300" },
  on_break: { label: "Nghỉ", cls: "bg-white/6 text-[#9b8e97]" },
  pre_assigned: { label: "Sắp vào", cls: "bg-pink-400/12 text-pink-300" },
  checked_out: { label: "Đã về", cls: "bg-white/6 text-[#7c7079]" },
};

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
  const [breakFor, setBreakFor] = useState<string | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [dongTour, setDongTour] = useState("");
  const [checkout, setCheckout] = useState<Set<string>>(new Set());

  const assignments = (asgQ.data ?? []) as EnrichedAssignment[];
  const roster = rosterQ.data ?? [];

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
      const next = (a as any)?.pre_assigned?.dealers?.full_name ?? null;
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

  const loading = clubsLoading || clubs === null;
  const noClub = clubs !== null && scopedIds.length === 0 && !isAdmin;

  const go = <T,>(setter: (v: T) => void, v: T) => { setTableSheet(null); setDealerSheet(null); requestAnimationFrame(() => setter(v)); };
  const soon = () => { setTableSheet(null); setDealerSheet(null); setPickFor(null); setBreakFor(null); setCheckinOpen(false); toast("Nút này đang được nối — sẽ bật sau khi anh xác nhận bảng thật đúng (UAT)"); };

  // ---- guards ----
  if (!user && !loading) return <Guard icon={<LogIn className="h-8 w-8 text-[#c9a86a]" />} title="Cần đăng nhập" sub="Đăng nhập tài khoản có quyền dealer để xem bảng xoay ca thật." onBack={() => navigate("/")} />;
  if (loading) return <Guard icon={<Loader2 className="h-8 w-8 animate-spin text-[#c9a86a]" />} title="Đang tải bảng…" sub="Lấy dữ liệu câu lạc bộ." onBack={() => navigate("/")} />;
  if (noClub) return <Guard icon={<Users className="h-8 w-8 text-amber-300" />} title="Chưa được phân công CLB" sub="Liên hệ quản trị để được gán quyền điều phối dealer." onBack={() => navigate("/")} />;

  const clubName = clubs && clubs.length ? clubs.map((c) => c.name).join(", ") : "Toàn quyền";

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Dealer Swing</h1>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">{clubName} · việc gấp tự nổi lên đầu</p>
      </header>

      <div className="rounded-xl bg-amber-400/8 px-3 py-2 text-[12px] text-amber-300/90">
        Dữ liệu <b>thật</b>. Các nút hành động đang được nối — bấm sẽ nhắc; sẽ bật sau khi anh xác nhận bảng đúng.
      </div>

      <div className="flex gap-1.5 px-1">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => setPill(p.key)}
            className={cn("ios-press-sm rounded-full px-3.5 py-1.5 text-[13px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
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
                      : <span className={cn("font-mono text-[13px]", c.cls)}>{c.text}</span>}
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
                    <span className="block font-mono text-[12px] text-[#9b8e97]">vào ca {hhmm(d.check_in_time)}{table ? ` · ${table}` : ""}{d.current_state === "on_break" ? " · đang nghỉ" : ""}</span>
                  </span>
                  <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", chip.cls)}>{chip.label}</span>
                </button>
              );
            })}
          </div>
        )
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
            <button onClick={() => setCheckinOpen(true)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <QrCode className="h-5 w-5 text-[#d8bc85]" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Check-in dealer mới</span><span className="block text-[12px] text-[#9b8e97]">quét QR hoặc chọn từ danh sách</span></span>
            </button>
            <button onClick={() => toast("Mở planner trên máy tính")} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <Monitor className="h-5 w-5 text-[#9b8e97]" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Gợi ý điều phối &amp; xếp lịch</span><span className="block text-[12px] text-[#9b8e97]">bản đầy đủ trên máy tính</span></span>
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
                  <button key={d.id} onClick={() => setCheckout((s) => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })}
                    className="ios-press-sm flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left">
                    <span className={cn("grid h-5 w-5 place-items-center rounded-md border", on ? "border-[#c9a86a] bg-[#c9a86a] text-[#241A08]" : "border-white/20 text-transparent")}>✓</span>
                    <span className="flex-1 text-[14px] text-[#f2ece6]">{d.dealers?.full_name ?? "—"}</span>
                    <span className="font-mono text-[12px] text-[#9b8e97]">vào {hhmm(d.check_in_time)}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={soon} disabled={checkout.size === 0}
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
                    <span className="font-mono text-[12px] text-[#7c7079]">ra {hhmm(d.check_out_time)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="ios-card border border-rose-500/20 p-3.5">
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-rose-300"><FlagTriangleRight className="h-4 w-4" /> Đóng tour</div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">lưu trữ toàn bộ ca + trả bàn về trống. Không hoàn tác.</div>
            <input value={dongTour} onChange={(e) => setDongTour(e.target.value.toUpperCase())} placeholder="gõ  DONG TOUR  để mở khoá"
              className="ios-fill mt-2.5 w-full rounded-xl px-3 py-2.5 text-center font-mono text-[14px] tracking-wider text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
            <button onClick={() => { soon(); setDongTour(""); }} disabled={dongTour.trim() !== "DONG TOUR"}
              className={cn("ios-press mt-2.5 w-full rounded-2xl py-3 text-[15px] font-bold", dongTour.trim() === "DONG TOUR" ? "bg-rose-500/90 text-white" : "bg-white/5 text-[#5f545c]")}>
              Đóng tour {dongTour.trim() !== "DONG TOUR" && "(đang khoá)"}
            </button>
          </div>
        </div>
      )}

      {/* D2 — sheet bàn */}
      <Sheet open={tableSheet !== null} onOpenChange={(v) => { if (!v) setTableSheet(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">
              {tableSheet?.name}
              {tableSheet && (tableSheet.missing || tableSheet.assignment?.isOverdue) && <span className="ml-2 rounded-full bg-rose-400/12 px-2 py-0.5 text-[11px] font-semibold text-rose-300">{tableSheet.missing ? "Thiếu dealer" : "OT"}</span>}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-center font-mono text-[13px] text-[#9b8e97]">{tableSheet?.dealer ?? "—"} · vào {tableSheet?.since}</div>
          {tableSheet?.next && (
            <div className="ios-card mt-3 flex items-center gap-2 px-3.5 py-2.5 text-[13px]">
              <Lightbulb className="h-4 w-4 text-[#d8bc85]" />
              <span className="text-[#d8bc85]">Kế tiếp theo lịch: <b>{tableSheet.next}</b></span>
            </div>
          )}
          <div className="mt-3 space-y-1.5">
            <button onClick={soon} className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
              <Repeat className="h-5 w-5 shrink-0" />
              <span className="text-[15px] font-bold">{tableSheet?.missing ? "Gán dealer ngay" : `Swing ngay${tableSheet?.next ? ` — ${tableSheet.next} vào thay` : ""}`}</span>
            </button>
            <SheetRow icon={<Users className="h-5 w-5 text-sky-300" />} label="Chọn dealer khác…" onTap={() => go(setPickFor, tableSheet)} />
            <SheetRow icon={<Coffee className="h-5 w-5 text-amber-300" />} label={`Cho ${tableSheet?.dealer ?? "dealer"} nghỉ sau khi thay`} onTap={() => go(setBreakFor, tableSheet?.dealer ?? "")} />
            <SheetRow icon={<ArrowRightLeft className="h-5 w-5 text-[#9b8e97]" />} label="Sửa nhầm bàn (đổi chéo)" onTap={soon} />
            <SheetRow icon={<History className="h-5 w-5 text-[#9b8e97]" />} label="Lịch sử bàn này" onTap={soon} />
          </div>
        </SheetContent>
      </Sheet>

      {/* D4 — sheet dealer */}
      <Sheet open={dealerSheet !== null} onOpenChange={(v) => { if (!v) setDealerSheet(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="items-center text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-sky-400 bg-[#241A2C] text-[15px] font-semibold text-sky-300">
              {(dealerSheet?.dealers?.full_name ?? "?").slice(0, 2)}
            </div>
            <SheetTitle className="mt-1.5 text-[16px] font-semibold text-[#f2ece6]">
              {dealerSheet?.dealers?.full_name} {dealerSheet && <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", (DEALER_CHIP[dealerSheet.current_state] ?? DEALER_CHIP.available).cls)}>{(DEALER_CHIP[dealerSheet.current_state] ?? DEALER_CHIP.available).label}</span>}
            </SheetTitle>
            <div className="font-mono text-[12px] text-[#9b8e97]">vào ca {hhmm(dealerSheet?.check_in_time)}{dealerSheet && tableByAttendance.get(dealerSheet.id) ? ` · ${tableByAttendance.get(dealerSheet.id)}` : ""}</div>
          </SheetHeader>
          <div className="mt-3 space-y-1.5">
            <button onClick={soon} className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
              <ArrowRight className="h-5 w-5 shrink-0" /><span className="text-[15px] font-bold">Đưa vào bàn…</span>
            </button>
            <SheetRow icon={<Coffee className="h-5 w-5 text-amber-300" />} label="Cho nghỉ ưu tiên" onTap={() => go(setBreakFor, dealerSheet?.dealers?.full_name ?? "")} />
            <SheetRow icon={<Clock className="h-5 w-5 text-[#9b8e97]" />} label="Ca hôm nay — giờ vào/ra, số bàn đã chia" onTap={soon} />
            <SheetRow icon={<LogOut className="h-5 w-5 text-rose-300" />} label={<span className="text-rose-300">Check-out khỏi ca</span>} onTap={soon} />
          </div>
        </SheetContent>
      </Sheet>

      {/* P1 — chọn dealer khác (roster sẵn sàng) */}
      <Sheet open={pickFor !== null} onOpenChange={(v) => { if (!v) setPickFor(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Chọn dealer vào {pickFor?.name}</SheetTitle></SheetHeader>
          <div className="ios-group mt-3">
            {roster.filter((d) => d.current_state === "available" || d.current_state === "on_break").length === 0
              ? <div className="px-4 py-6 text-center text-[13px] text-[#9b8e97]">Không có dealer đang rảnh.</div>
              : roster.filter((d) => d.current_state === "available" || d.current_state === "on_break").map((d) => {
                const locked = d.current_state !== "available";
                return (
                  <button key={d.id} disabled={locked} onClick={soon}
                    className={cn("ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left", !locked && "ios-press-sm", locked && "opacity-55")}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] text-[#f2ece6]">{d.dealers?.full_name ?? "—"}</span>
                      <span className="block font-mono text-[12px] text-[#9b8e97]">vào ca {hhmm(d.check_in_time)}{locked ? " · đang nghỉ" : ""}</span>
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
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Cho {breakFor} nghỉ</SheetTitle></SheetHeader>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {BREAK_PRESETS.map((m) => (
              <button key={m} onClick={soon} className="ios-press ios-fill rounded-2xl py-3 text-center text-[15px] font-semibold text-[#f2ece6]">{m}p</button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* P2 — check-in */}
      <Sheet open={checkinOpen} onOpenChange={setCheckinOpen}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Check-in dealer</SheetTitle></SheetHeader>
          <div className="mt-3 grid h-[76px] place-items-center rounded-2xl border border-dashed border-white/15 text-[13px] text-[#9b8e97]">
            <span className="flex flex-col items-center gap-1"><QrCode className="h-6 w-6 text-[#d8bc85]" /> đưa QR dealer vào khung</span>
          </div>
          <button onClick={soon} className="ios-press ios-fill mt-3 w-full rounded-2xl py-3 text-[14px] font-medium text-[#f2ece6]">Chọn từ danh sách theo lịch</button>
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

function Line({ l, v, vCls }: { l: string; v: string; vCls?: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-[14px]">
      <span className="text-[#9b8e97]">{l}</span>
      <span className={cn("font-mono text-[16px] font-semibold", vCls ?? "text-[#f2ece6]")}>{v}</span>
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
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Dealer Swing</h1>
      </header>
      <div className="ios-card flex flex-col items-center gap-2 py-12 text-center">
        {icon}
        <div className="mt-1 text-[16px] font-semibold text-[#f2ece6]">{title}</div>
        <div className="max-w-[260px] text-[13px] text-[#9b8e97]">{sub}</div>
      </div>
    </div>
  );
}
