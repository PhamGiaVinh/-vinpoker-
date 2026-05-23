import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  useCheckedInDealers, useActiveTables, useActiveAssignments, useSwingConfigs, useAuditLogs,
} from "@/hooks/useDealerSwing";
import type { DealerAssignment, DealerAttendance, SwingConfig } from "@/hooks/useDealerSwing";
import { exportToExcel } from "@/lib/exportExcel";
import {
  Users, Table2, Bell, Play, RefreshCw, UserPlus, UserMinus,
  Send, FileSpreadsheet, DollarSign, Loader2, Clock, AlertTriangle,
  Plus, MessageCircle, Save, Settings,
} from "lucide-react";

type ClubRow = { id: string; name: string };
type Tour = { id: string; club_id: string; tour_name: string; start_time: string; end_time: string; tour_tier?: string };

function useTours(clubIds: string[]) {
  const [data, setData] = useState<Tour[] | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!clubIds.length) { setData([]); return; }
    setLoading(true);
    const { data: d } = await supabase.from("dealer_shifts").select("*").in("club_id", clubIds).order("start_time");
    setData(d ?? []); setLoading(false);
  }, [clubIds.join(",")]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, refetch: load };
}

/* ==============================================================
   SWING PANEL — Main 3-Column Layout
   ============================================================== */
export default function SwingPanel({ clubIds, clubs }: { clubIds: string[]; clubs: ClubRow[] }) {
  const [clubFilter, setClubFilter] = useState<string | null>(clubIds.length === 1 ? clubIds[0] : null);
  const filteredClubIds = clubFilter ? [clubFilter] : clubIds;
  const [selectedTour, setSelectedTour] = useState<string | null>(null);

  const { data: dealers, loading: dealersLoading, refetch: refetchDealers } = useCheckedInDealers(filteredClubIds, selectedTour ?? undefined);
  const { data: tables, loading: tablesLoading, refetch: refetchTables } = useActiveTables(filteredClubIds);
  const { data: assignments, loading: assignsLoading, refetch: refetchAssignments } = useActiveAssignments(filteredClubIds);
  const { data: swingConfigs, refetch: refetchSwingConfigs } = useSwingConfigs(filteredClubIds);
  const auditLogs = useAuditLogs(filteredClubIds, 15);
  const { data: tours, refetch: refetchTours } = useTours(filteredClubIds);

  const [processing, setProcessing] = useState<string | null>(null);
  const [swingAllBusy, setSwingAllBusy] = useState(false);
  const [modalTable, setModalTable] = useState<string | null>(null);
  const [manualDealerId, setManualDealerId] = useState<string>("");
  const [suggestions, setSuggestions] = useState<any[] | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinDealerId, setCheckinDealerId] = useState("");
  const [checkinDealers, setCheckinDealers] = useState<any[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutAttendanceId, setCheckoutAttendanceId] = useState("");
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [newTableType, setNewTableType] = useState("cash");

  // Telegram config state
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [telegramClubId, setTelegramClubId] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramSaving, setTelegramSaving] = useState(false);

  // Swing config state
  const [swingConfigOpen, setSwingConfigOpen] = useState(false);

  // Payroll modal state
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [payrollData, setPayrollData] = useState<any[] | null>(null);
  const [payrollClubSlug, setPayrollClubSlug] = useState("");

  // Create tour state
  const [createTourOpen, setCreateTourOpen] = useState(false);
  const [newTourName, setNewTourName] = useState("");
  const [newTourStartTime, setNewTourStartTime] = useState("");
  const [newTourEndTime, setNewTourEndTime] = useState("");

  const { user } = useAuth();

  const isSubmitting = useRef(false);

  // Map tables to their current assignment
  const tableAssignmentMap = useMemo(() => {
    const map: Record<string, DealerAssignment | null> = {};
    for (const t of tables ?? []) {
      const a = (assignments ?? []).find((a) => a.table_id === t.id && a.status !== "completed");
      map[t.id] = a ?? null;
    }
    return map;
  }, [tables, assignments]);

  // Get swing config for a table
  const getConfig = (tableType: string): SwingConfig | undefined =>
    swingConfigs?.find((c) => (clubFilter ? c.club_id === clubFilter : true) && c.table_type === tableType);

  // Trigger auto-swing all
  const autoSwingAll = async () => {
    setSwingAllBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("process-swing", {});
      if (error) { toast.error(error.message); return; }
      toast.success(`Đã xử lý ${(data as any)?.processed ?? 0} swing`);
      refetchAssignments();
      refetchTables();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSwingAllBusy(false);
    }
  };

  // Open assignment modal for a table
  const openAssignModal = async (tableId: string) => {
    setModalTable(tableId);
    setManualDealerId("");
    setSuggestions(null);
    try {
      const { data, error } = await supabase.functions.invoke("assign-dealer", {
        body: { table_id: tableId, requested_by: user?.id, return_suggestions_only: true, shift_id: selectedTour ?? undefined },
      });
      if (error) { toast.error(`Lỗi gợi ý: ${error.message}`); return; }
      setSuggestions((data as any)?.suggestions ?? []);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Confirm assignment
  const confirmAssign = async (forceDealerId?: string) => {
    if (!modalTable) return;
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    setAssigning(true);
    try {
      const { data, error } = await supabase.functions.invoke("assign-dealer", {
        body: {
          table_id: modalTable,
          force_dealer_id: forceDealerId || undefined,
          requested_by: user?.id,
          idempotency_key: crypto.randomUUID(),
          shift_id: selectedTour ?? undefined,
        },
      });
      if (error) {
        let detail = error.message;
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => null);
          detail = body?.error ?? body?.message ?? detail;
          console.error("[confirmAssign] edge function returned:", { status: error.context.status, body });
        }
        toast.error(`Lỗi gán: ${detail}`);
        return;
      }
      if ((data as any)?.error) { toast.error((data as any).error); return; }
      toast.success("Đã gán dealer");
      // Telegram notification
      const table = (tables ?? []).find((t) => t.id === modalTable);
      const tableName = table?.table_name ?? "";
      const dealerName = forceDealerId
        ? (dealers ?? []).find((d) => d.dealer_id === forceDealerId)?.dealers?.full_name ?? ""
        : (suggestions ?? [])[0]?.dealer_name ?? "";
      const tourName = getTourName();
      sendTelegram(`🔵 ${dealerName} được assign vào ${tableName}${tourName ? ` (Tour: ${tourName})` : ""}`);
      setModalTable(null);
      refetchAssignments();
      refetchDealers();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAssigning(false);
      isSubmitting.current = false;
    }
  };

  // Send dealer to break
  const sendToBreak = async (attendanceId: string) => {
    setProcessing(attendanceId);
    try {
      const { data, error } = await supabase.functions.invoke("manage-break", {
        body: { attendance_id: attendanceId, action: "start", requested_by: user?.id },
      });
      if (error) { toast.error(error.message); return; }
      toast.success("Đã gửi dealer đi nghỉ");
      // Telegram notification
      const breakDealer = (dealers ?? []).find((d) => d.id === attendanceId);
      const breakName = breakDealer?.dealers?.full_name ?? "";
      const breakEnd = new Date(Date.now() + 15 * 60000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      const tourName = getTourName();
      sendTelegram(`☕ ${breakName} bắt đầu nghỉ${tourName ? ` (Tour: ${tourName})` : ""}. Dự kiến quay lại lúc: ${breakEnd}.`);
      refetchAssignments();
      refetchDealers();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProcessing(null);
    }
  };

  // End break for dealer
  const endBreak = async (attendanceId: string) => {
    setProcessing(attendanceId);
    try {
      const { data, error } = await supabase.functions.invoke("manage-break", {
        body: { attendance_id: attendanceId, action: "end", requested_by: user?.id },
      });
      if (error) { toast.error(error.message); return; }
      toast.success("Dealer đã quay lại");
      // Telegram notification
      const backDealer = (dealers ?? []).find((d) => d.id === attendanceId);
      const backName = backDealer?.dealers?.full_name ?? "";
      const tourName = getTourName();
      sendTelegram(`✅ ${backName} đã quay lại từ break${tourName ? ` (Tour: ${tourName})` : ""}.`);
      refetchAssignments();
      refetchDealers();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProcessing(null);
    }
  };

  // Send Telegram notification
  const sendTelegram = async (message: string) => {
    const clubId = clubFilter ?? filteredClubIds[0];
    if (!clubId) return;
    const { error } = await supabase.functions.invoke("telegram-swing-notifier", {
      body: { chat_id: "__club__", message, club_id: clubId },
    });
    if (error) toast.error("Không gửi được Telegram, vui lòng kiểm tra kết nối.");
  };

  // Get current tour name
  const getTourName = () => {
    if (!selectedTour) return "";
    const tour = (tours ?? []).find((t) => t.id === selectedTour);
    return tour ? tour.tour_name : "";
  };

  // Load dealers for manual check-in (exclude already checked-in today)
  const loadCheckinDealers = async () => {
    const { data: dealers } = await supabase
      .from("dealers")
      .select("id, full_name, tier")
      .in("club_id", filteredClubIds)
      .eq("status", "scheduled")
      .order("full_name");
    if (!dealers?.length) { setCheckinDealers([]); return; }
    const today = new Date().toISOString().split("T")[0];
    const { data: checkedIn } = await supabase
      .from("dealer_attendance")
      .select("dealer_id")
      .eq("shift_date", today)
      .eq("status", "checked_in")
      .in("dealer_id", dealers.map((d) => d.id));
    const checkedInIds = new Set((checkedIn ?? []).map((c) => c.dealer_id));
    setCheckinDealers(dealers.filter((d) => !checkedInIds.has(d.id)));
  };

  // Manual check-in
  const doCheckin = async () => {
    if (!checkinDealerId) return;
    setProcessing("checkin");
    // Find today's shift
    const today = new Date().toISOString().split("T")[0];
    const { data: shifts } = await supabase
      .from("dealer_shifts")
      .select("id")
      .in("club_id", filteredClubIds)
      .order("start_time")
      .limit(1);
    const shiftId = (shifts ?? [])[0]?.id;

    const { error } = await supabase.from("dealer_attendance").upsert({
      dealer_id: checkinDealerId,
      shift_id: shiftId ?? null,
      shift_date: today,
      status: "checked_in",
      check_in_time: new Date().toISOString(),
    }, { onConflict: "dealer_id, shift_id, shift_date", ignoreDuplicates: false });

    setProcessing(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Đã check-in dealer");
    setCheckinOpen(false);
    refetchDealers();
  };

  // Manual check-out (only if currently checked_in)
  const doCheckout = async () => {
    if (!checkoutAttendanceId) return;
    setProcessing("checkout");
    const { data: att } = await supabase
      .from("dealer_attendance")
      .select("status")
      .eq("id", checkoutAttendanceId)
      .single();
    if (!att || att.status !== "checked_in") {
      setProcessing(null);
      toast.error("Dealer không trong trạng thái check-in");
      return;
    }
    const { error } = await supabase
      .from("dealer_attendance")
      .update({
        status: "checked_out",
        check_out_time: new Date().toISOString(),
      })
      .eq("id", checkoutAttendanceId);
    setProcessing(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Đã check-out dealer");
    setCheckoutOpen(false);
    refetchDealers();
  };

  // Export shift report
  const exportShiftReport = async () => {
    if (!clubFilter && clubIds.length > 1) {
      toast.error("Vui lòng chọn một CLB trước khi xuất");
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    const rows = (assignments ?? []).map((a) => ({
      "Bàn": (a as any).game_tables?.table_name ?? "",
      "Loại bàn": (a as any).game_tables?.table_type ?? "",
      "Dealer": (a as any).dealer_attendance?.dealers?.full_name ?? "",
      "Hạng": (a as any).dealer_attendance?.dealers?.tier ?? "",
      "Bắt đầu": a.assigned_at ? new Date(a.assigned_at).toLocaleTimeString("vi-VN") : "",
      "Trạng thái": a.status === "assigned" ? "Đang bàn" : a.status === "on_break" ? "Đang nghỉ" : "",
    }));
    exportToExcel(`shift-report-${today}`, rows);
    toast.success("Đã tải báo cáo ca");
  };

  // Payroll: fetch data and open modal instead of direct export
  const openPayroll = async () => {
    if (!clubFilter && clubIds.length > 1) {
      toast.error("Vui lòng chọn một CLB trước khi xem lương");
      return;
    }
    const today = new Date().toISOString().split("T")[0];
    const clubId = clubFilter ?? clubIds[0];
    const { data: rows } = await supabase.rpc("get_shift_payroll_summary", {
      p_club_id: clubId,
      p_shift_date: today,
    });
    if (!rows?.length) { toast.error("Không có dữ liệu lương cho hôm nay"); return; }
    // Get club slug for filename
    const { data: club } = await supabase.from("clubs").select("slug").eq("id", clubId).single();
    setPayrollData(rows as any[]);
    setPayrollClubSlug((club as any)?.slug ?? "club");
    setPayrollOpen(true);
  };

  const doExportPayrollCsv = () => {
    if (!payrollData?.length) return;
    const today = new Date().toISOString().split("T")[0];
    exportToExcel(`bang-luong-${payrollClubSlug}-${today}`, payrollData.map((r: any) => ({
      "Dealer": r.dealer_name,
      "Hạng": r.tier,
      "Tổng phút": r.total_minutes,
      "OT phút": r.overtime_minutes,
      "Số bàn": r.tables_served,
      "Số swing": r.swings_done,
      "Lương cơ bản": r.base_pay?.toLocaleString("vi-VN"),
      "Lương OT": r.overtime_pay?.toLocaleString("vi-VN"),
    })));
    toast.success("Đã tải bảng lương");
  };

  const loading = dealersLoading || tablesLoading || assignsLoading;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {clubs.length > 1 && (
          <Select value={clubFilter ?? ""} onValueChange={(v) => setClubFilter(v || null)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Tất cả CLB" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tất cả CLB</SelectItem>
              {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" variant="outline" onClick={() => { refetchDealers(); refetchTables(); refetchAssignments(); }}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Làm mới
        </Button>
        <Button size="sm" variant="outline" onClick={() => {
          const cid = clubFilter || filteredClubIds[0] || "";
          setTelegramClubId(cid);
          (async () => {
            const { data } = await supabase.from("club_settings").select("telegram_chat_id").eq("club_id", cid).maybeSingle();
            setTelegramChatId((data as any)?.telegram_chat_id ?? "");
          })();
          setTelegramOpen(true);
        }}>
          <MessageCircle className="w-3.5 h-3.5 mr-1" /> Telegram
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSwingConfigOpen(true)}>
          <Settings className="w-3.5 h-3.5 mr-1" />
          Swing: {swingConfigs?.find((c) => (clubFilter ? c.club_id === clubFilter : true) && c.table_type === "cash")?.swing_duration_minutes ?? "—"}m
          {" / "}Break: {swingConfigs?.find((c) => (clubFilter ? c.club_id === clubFilter : true) && c.table_type === "cash")?.break_duration_minutes ?? "—"}m
        </Button>
      </div>

      {/* Tour Filter Bar */}
      <div className="sticky top-0 z-10 bg-background pb-2 border-b border-border">
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs font-semibold text-muted-foreground mr-1">Tour:</span>
          <button onClick={() => setSelectedTour(null)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${selectedTour === null ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/50" : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"}`}>
            Tổng thể
          </button>
          {(tours ?? []).map((t) => (
            <button key={t.id} onClick={() => setSelectedTour(t.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${selectedTour === t.id ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/50" : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"}`}>
              {t.tour_name} ({t.start_time?.slice(0, 5)}-{t.end_time?.slice(0, 5)})
            </button>
          ))}
        </div>
        {(tours ?? []).length === 0 && selectedTour === null && (
          <div className="text-xs text-amber-500 mt-1 flex items-center gap-2">
            <span>Chưa có tour nào. </span>
            <button onClick={() => setCreateTourOpen(true)} className="underline hover:text-amber-400">Tạo tour mới</button>
          </div>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-96 rounded-none" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* LEFT COLUMN — 25% */}
          <div className="lg:col-span-3">
            <RosterPanel
              dealers={dealers ?? []}
              assignments={assignments ?? []}
              swingConfigs={swingConfigs ?? []}
              processing={processing}
              onSendToBreak={sendToBreak}
              onEndBreak={endBreak}
              onCheckinOpen={() => { loadCheckinDealers(); setCheckinOpen(true); }}
              onCheckoutOpen={() => setCheckoutOpen(true)}
            />
          </div>

          {/* CENTER COLUMN — 50% */}
          <div className="lg:col-span-6">
            <TableGrid
              tables={tables ?? []}
              tableAssignmentMap={tableAssignmentMap}
              swingConfigs={swingConfigs ?? []}
              processing={processing}
              onAssign={openAssignModal}
              onSendToBreak={(attId) => sendToBreak(attId)}
              selectedTour={selectedTour}
              onCreateTable={() => setCreateTableOpen(true)}
            />
          </div>

          {/* RIGHT COLUMN — 25% */}
          <div className="lg:col-span-3">
            <CommandCenter
              auditLogs={auditLogs ?? []}
              onAutoSwing={autoSwingAll}
              onExportShift={exportShiftReport}
              onExportPayroll={openPayroll}
              swingAllBusy={swingAllBusy}
              clubFilter={clubFilter}
              clubs={clubs}
              onOpenSwingConfig={() => setSwingConfigOpen(true)}
            />
          </div>
        </div>
      )}

      {/* Assignment Modal */}
      <Dialog open={!!modalTable} onOpenChange={(o) => !o && setModalTable(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gán Dealer</DialogTitle>
            <DialogDescription>Chọn dealer phù hợp cho bàn này.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {suggestions === null ? (
              <div className="text-sm text-muted-foreground">Đang tìm dealer phù hợp...</div>
            ) : suggestions.length === 0 ? (
              <div className="text-sm text-warning">Không có dealer sẵn sàng.</div>
            ) : (
              <>
                <div className="text-xs font-semibold text-muted-foreground mb-2">Gợi ý hàng đầu:</div>
                {suggestions.map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-muted/20 border border-border rounded-none">
                    <div>
                      <div className="font-semibold">{s.dealer_name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <TierBadge tier={s.tier} />
                        <span className="text-xs text-muted-foreground">{s.reason}</span>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => confirmAssign(s.dealer_id)} disabled={assigning}>
                      {assigning ? <Loader2 className="w-3 h-3 animate-spin" /> : "Gán"}
                    </Button>
                  </div>
                ))}
              </>
            )}
            <div className="border-t border-border pt-3 mt-3">
              <Label className="text-xs">Gán thủ công:</Label>
              <Select value={manualDealerId} onValueChange={setManualDealerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn dealer..." />
                </SelectTrigger>
                <SelectContent>
                  {(dealers ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.dealer_id}>
                      {(d as any).dealers?.full_name ?? d.dealer_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="w-full mt-2"
                size="sm"
                disabled={!manualDealerId || assigning}
                onClick={() => confirmAssign(manualDealerId)}
              >
                {assigning ? <Loader2 className="w-3 h-3 animate-spin" /> : "Xác nhận gán thủ công"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Check-in Dialog */}
      <Dialog open={checkinOpen} onOpenChange={setCheckinOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Check-in thủ công</DialogTitle></DialogHeader>
          <Select value={checkinDealerId} onValueChange={setCheckinDealerId}>
            <SelectTrigger><SelectValue placeholder="Chọn dealer..." /></SelectTrigger>
            <SelectContent>
              {checkinDealers.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>{d.full_name} ({d.tier})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button onClick={doCheckin} disabled={!checkinDealerId || processing === "checkin"}>
              {processing === "checkin" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Check-in"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check-out Dialog */}
      <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Check-out thủ công</DialogTitle></DialogHeader>
          <DialogDescription>Chọn dealer đã check-in để check-out.</DialogDescription>
          <Select value={checkoutAttendanceId} onValueChange={setCheckoutAttendanceId}>
            <SelectTrigger><SelectValue placeholder="Chọn dealer..." /></SelectTrigger>
            <SelectContent>
              {(dealers ?? []).map((d: any) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.dealers?.full_name ?? d.dealer_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button onClick={doCheckout} disabled={!checkoutAttendanceId || processing === "checkout"}>
              {processing === "checkout" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Check-out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Table Creation Dialog */}
      <Dialog open={createTableOpen} onOpenChange={setCreateTableOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tạo bàn mới</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tên bàn</Label>
              <Input value={newTableName} onChange={(e) => setNewTableName(e.target.value)} placeholder="VD: T25" />
            </div>
            <div>
              <Label className="text-xs">Loại bàn</Label>
              <Select value={newTableType} onValueChange={setNewTableType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="tournament">Tournament</SelectItem>
                  <SelectItem value="vip">VIP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTableOpen(false)}>Huỷ</Button>
            <Button disabled={!newTableName.trim() || processing === "create_table"}
              onClick={async () => {
                setProcessing("create_table");
                const clubId = clubFilter ?? filteredClubIds[0];
                if (!clubId || !newTableName.trim()) { setProcessing(null); return; }
                const { error } = await supabase.from("game_tables").insert({
                  club_id: clubId,
                  table_name: newTableName.trim(),
                  table_type: newTableType,
                  status: "active",
                });
                setProcessing(null);
                if (error) { toast.error(error.message); return; }
                toast.success("Đã tạo bàn mới");
                setCreateTableOpen(false);
                setNewTableName("");
                setNewTableType("cash");
                refetchTables();
                // table stays in current tour view (empty tables are visible in all tours)
              }}>
              {processing === "create_table" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Tạo bàn"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Telegram Config Dialog */}
      <Dialog open={telegramOpen} onOpenChange={setTelegramOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cài đặt Telegram</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {clubs.length > 1 && (
              <div>
                <Label className="text-xs">Câu lạc bộ</Label>
                <Select value={telegramClubId} onValueChange={async (v) => {
                  setTelegramClubId(v);
                  const { data } = await supabase.from("club_settings").select("telegram_chat_id").eq("club_id", v).maybeSingle();
                  setTelegramChatId((data as any)?.telegram_chat_id ?? "");
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">Telegram Chat ID</Label>
              <Input
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="-100xxxxxxxxxx"
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Thêm bot @VBACKERBOT vào group, gửi /id để lấy Chat ID.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTelegramOpen(false)}>Huỷ</Button>
            <Button onClick={async () => {
              setTelegramSaving(true);
              const { error } = await supabase.from("club_settings").upsert(
                { club_id: telegramClubId, telegram_chat_id: telegramChatId.trim() || null },
                { onConflict: "club_id" }
              );
              setTelegramSaving(false);
              if (error) { toast.error(error.message); return; }
              toast.success("Đã lưu Telegram Chat ID");
              setTelegramOpen(false);
            }} disabled={telegramSaving}>
              {telegramSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Save className="w-3.5 h-3.5 mr-1" />Lưu</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Swing Config Dialog */}
      <SwingConfigDialog
        open={swingConfigOpen}
        onOpenChange={setSwingConfigOpen}
        clubId={clubFilter ?? filteredClubIds[0] ?? ""}
        currentConfigs={swingConfigs ?? []}
        onSaved={refetchSwingConfigs}
      />

      {/* Payroll Preview Dialog */}
      <Dialog open={payrollOpen} onOpenChange={(o) => { if (!o) setPayrollOpen(false); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Bảng lương — {payrollClubSlug}</DialogTitle>
            <DialogDescription>
              {new Date().toLocaleDateString("vi-VN")} · {payrollData?.length ?? 0} dealer
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dealer</TableHead>
                  <TableHead>Hạng</TableHead>
                  <TableHead className="text-right">Tổng phút</TableHead>
                  <TableHead className="text-right">OT phút</TableHead>
                  <TableHead className="text-right">Số bàn</TableHead>
                  <TableHead className="text-right">Số swing</TableHead>
                  <TableHead className="text-right">Lương cơ bản</TableHead>
                  <TableHead className="text-right">Lương OT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(payrollData ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Không có dữ liệu</TableCell></TableRow>
                ) : (payrollData ?? []).map((r: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.dealer_name}</TableCell>
                    <TableCell>{r.tier}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.total_minutes}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.overtime_minutes}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.tables_served}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.swings_done}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.base_pay?.toLocaleString("vi-VN")}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.overtime_pay?.toLocaleString("vi-VN")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayrollOpen(false)}>Đóng</Button>
            <Button onClick={doExportPayrollCsv}>
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Xuất CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Tour Dialog */}
      <Dialog open={createTourOpen} onOpenChange={setCreateTourOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tạo tour mới</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tên tour</Label>
              <Input value={newTourName} onChange={(e) => setNewTourName(e.target.value)} placeholder="VD: Tour Sáng" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Giờ bắt đầu</Label>
                <Input type="time" value={newTourStartTime} onChange={(e) => setNewTourStartTime(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Giờ kết thúc</Label>
                <Input type="time" value={newTourEndTime} onChange={(e) => setNewTourEndTime(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTourOpen(false)}>Huỷ</Button>
            <Button disabled={!newTourName.trim() || !newTourStartTime || !newTourEndTime}
              onClick={async () => {
                setProcessing("create_tour");
                const clubId = clubFilter ?? filteredClubIds[0];
                if (!clubId || !newTourName.trim() || !newTourStartTime || !newTourEndTime) { setProcessing(null); return; }
                const { error } = await supabase.from("dealer_shifts").insert({
                  club_id: clubId,
                  tour_name: newTourName.trim(),
                  start_time: newTourStartTime,
                  end_time: newTourEndTime,
                });
                setProcessing(null);
                if (error) { toast.error(error.message); return; }
                toast.success("Đã tạo tour mới");
                setCreateTourOpen(false);
                setNewTourName("");
                setNewTourStartTime("");
                setNewTourEndTime("");
                refetchTours();
              }}>
              {processing === "create_tour" ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Plus className="w-3.5 h-3.5 mr-1" />Tạo tour</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ==============================================================
   ROSTER PANEL — Left Column
   ============================================================== */
function DealerTimer({ startTime }: { startTime: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.floor((now - new Date(startTime).getTime()) / (1000 * 60));
  const h = Math.floor(elapsed / 60);
  const m = elapsed % 60;
  return (
    <span className="font-mono text-[10px]">
      {h > 0 ? `${h}h ` : ""}{m}m
    </span>
  );
}

function RosterPanel({
  dealers, assignments, swingConfigs, processing, onSendToBreak, onEndBreak, onCheckinOpen, onCheckoutOpen,
}: {
  dealers: DealerAttendance[];
  assignments: DealerAssignment[];
  swingConfigs: SwingConfig[];
  processing: string | null;
  onSendToBreak: (attendanceId: string) => void;
  onEndBreak: (attendanceId: string) => void;
  onCheckinOpen: () => void;
  onCheckoutOpen: () => void;
}) {
  const dealerStatuses = useMemo(() => {
    const map: Record<string, { status: string; tableName?: string; checkInTime: string; timerStart: string }> = {};
    for (const d of dealers) {
      const a = assignments.find((a) => a.attendance_id === d.id);
      const checkInTime = d.check_in_time ?? new Date().toISOString();
      if (a?.status === "assigned") {
        map[d.id] = { status: "Đang bàn", tableName: (a as any).game_tables?.table_name, checkInTime, timerStart: a.assigned_at };
      } else if (a?.status === "on_break") {
        map[d.id] = { status: "Đang nghỉ", tableName: undefined, checkInTime, timerStart: a.released_at ?? checkInTime };
      } else {
        map[d.id] = { status: "Sẵn sàng", tableName: undefined, checkInTime, timerStart: checkInTime };
      }
    }
    return map;
  }, [dealers, assignments]);

  const sections = [
    { key: "Sẵn sàng", icon: Users, color: "text-emerald-400" },
    { key: "Đang bàn", icon: Table2, color: "text-blue-400" },
    { key: "Đang nghỉ", icon: Clock, color: "text-amber-400" },
  ] as const;

  return (
    <Card className="p-3 h-full">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-primary" />
        <span className="font-display text-sm tracking-wider">ĐỘI HÌNH CHIẾN BINH</span>
      </div>

      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {dealers.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6">Chưa có dealer check-in hôm nay.</div>
        ) : (
          sections.map((sec) => {
            const group = dealers.filter((d) => dealerStatuses[d.id]?.status === sec.key);
            if (!group.length) return null;
            const Icon = sec.icon;
            return (
              <div key={sec.key}>
                <div className="flex items-center gap-1.5 mb-2 sticky top-0 bg-card z-10 pb-1">
                  <Icon className={`w-3 h-3 ${sec.color}`} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{sec.key}</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">{group.length}</Badge>
                </div>
                <div className="space-y-1.5">
                  {group.map((d) => {
                    const dd = d.dealers;
                    const info = dealerStatuses[d.id];
                    const isBusy = processing === d.id;
                    const ready = sec.key === "Sẵn sàng";
                    const onBreak = sec.key === "Đang nghỉ";
                    return (
                      <div key={d.id} className="flex items-center gap-2 p-2 bg-muted/10 border border-border rounded-none">
                        <div className="w-8 h-8 rounded-none bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                          {dd?.full_name?.charAt(0) ?? "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{dd?.full_name ?? "—"}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <TierBadge tier={dd?.tier} />
                            <StatusPill status={sec.key} />
                            {info?.tableName && (
                              <span className="text-[10px] text-muted-foreground truncate">· {info.tableName}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            <Clock className="w-3 h-3 inline mr-0.5" />
                            {sec.key === "Đang nghỉ" ? "Nghỉ " : ""}
                            <DealerTimer startTime={info?.timerStart ?? info?.checkInTime ?? new Date().toISOString()} />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          {ready && (
                            <Button size="icon" variant="ghost" className="h-6 w-6" title="Gửi nghỉ"
                              onClick={() => onSendToBreak(d.id)} disabled={isBusy}>
                              <Clock className="w-3 h-3" />
                            </Button>
                          )}
                          {onBreak && (
                            <Button size="icon" variant="ghost" className="h-6 w-6" title="Kết thúc nghỉ"
                              onClick={() => onEndBreak(d.id)} disabled={isBusy}>
                              <Play className="w-3 h-3 text-primary" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-2 mt-3 pt-3 border-t border-border">
        <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onCheckinOpen}>
          <UserPlus className="w-3 h-3 mr-1" /> Check-in
        </Button>
        <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onCheckoutOpen}>
          <UserMinus className="w-3 h-3 mr-1" /> Check-out
        </Button>
      </div>
    </Card>
  );
}

/* ==============================================================
   TABLE GRID — Center Column
   ============================================================== */
function TableGrid({
  tables, tableAssignmentMap, swingConfigs, processing, onAssign, onSendToBreak, selectedTour, onCreateTable,
}: {
  tables: any[];
  tableAssignmentMap: Record<string, DealerAssignment | null>;
  swingConfigs: SwingConfig[];
  processing: string | null;
  onAssign: (tableId: string) => void;
  onSendToBreak: (attendanceId: string) => void;
  selectedTour: string | null;
  onCreateTable: () => void;
}) {
  const deactivateTable = async (tableId: string) => {
    const { error } = await supabase.from("game_tables").update({ status: "inactive" }).eq("id", tableId);
    if (error) toast.error(error.message);
    else toast.success("Đã vô hiệu hoá bàn");
  };

  // Filter tables based on selected tour
  const filteredTables = useMemo(() => {
    if (!selectedTour) return tables;
    // Show tables assigned to this tour + all empty tables (no dealer assigned)
    return tables.filter((t) => {
      const a = tableAssignmentMap[t.id];
      if (!a) return true;
      return (a as any).dealer_attendance?.shift_id === selectedTour;
    });
  }, [tables, tableAssignmentMap, selectedTour]);

  return (
    <Card className="p-3 h-full">
      <div className="flex items-center gap-2 mb-3">
        <Table2 className="w-4 h-4 text-primary" />
        <span className="font-display text-sm tracking-wider">BẢN ĐỒ CHIẾN TRƯỜNG</span>
        <Badge variant="outline" className="ml-auto text-xs">{filteredTables.length} bàn</Badge>
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={onCreateTable}>
          + Tạo bàn mới
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
        {filteredTables.length === 0 ? (
          <div className="col-span-full text-xs text-muted-foreground text-center py-6">
            {selectedTour ? "Chưa có bàn nào trong tour này. Hãy tạo bàn mới hoặc assign dealer." : "Chưa có bàn nào."}
          </div>
        ) : (
          filteredTables.map((t) => {
            const a = tableAssignmentMap[t.id];
            const config = swingConfigs?.find((c) => c.table_type === t.table_type);
            const swingDuration = config?.swing_duration_minutes ?? 45;
            const warnAt = config?.warn_at_minutes ?? 5;
            const critAt = config?.crit_at_minutes ?? 1;

            const dealer = a ? (a as any).dealer_attendance?.dealers : null;

            return (
              <div key={t.id} className="p-3 bg-muted/10 border border-border rounded-none animate-in fade-in slide-in-from-bottom-1 duration-300">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-sm">{t.table_name}</div>
                  <div className="flex items-center gap-1">
                    <TableTypeBadge type={t.table_type} />
                    <button className="text-muted-foreground hover:text-destructive text-xs ml-1" title="Vô hiệu hoá bàn"
                      onClick={() => deactivateTable(t.id)}>
                      ✕
                    </button>
                  </div>
                </div>

                {/* Dealer info */}
                <div className="flex items-center gap-2 mb-2">
                  {dealer ? (
                    <>
                      <div className="w-6 h-6 rounded-none bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                        {dealer.full_name?.charAt(0) ?? "?"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{dealer.full_name}</div>
                        <TierBadge tier={dealer.tier} />
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-warning flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Trống
                    </div>
                  )}
                </div>

                {/* Countdown timer — self-updating via 1s interval */}
                {a && (
                  <TimerCell assignedAt={a.assigned_at} swingDuration={swingDuration} warnAt={warnAt} critAt={critAt} />
                )}

                {/* Action buttons */}
                <div className="flex gap-1.5 mt-2">
                  {a && a.status === "assigned" && (
                    <>
                      <Button size="sm" variant="outline" className="flex-1 text-xs h-7"
                        onClick={() => onSendToBreak(a.attendance_id)} disabled={processing === a.attendance_id}>
                        <Clock className="w-3 h-3 mr-1" /> Nghỉ
                      </Button>
                      {!a.swing_processed_at && (
                        <Button size="sm" variant="outline" className="flex-1 text-xs h-7 text-amber-500 border-amber-500/30"
                          disabled>
                          <RefreshCw className="w-3 h-3 mr-1" /> Swing
                        </Button>
                      )}
                    </>
                  )}
                  {!a && (
                    <Button size="sm" variant="outline" className="flex-1 text-xs h-7 text-primary"
                      onClick={() => onAssign(t.id)}>
                      <Users className="w-3 h-3 mr-1" /> Gán
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

/* ==============================================================
   COMMAND CENTER — Right Column
   ============================================================== */
function CommandCenter({
  auditLogs, onAutoSwing, onExportShift, onExportPayroll, swingAllBusy, clubFilter, clubs, onOpenSwingConfig,
}: {
  auditLogs: any[];
  onAutoSwing: () => void;
  onExportShift: () => void;
  onExportPayroll: () => void;
  swingAllBusy: boolean;
  clubFilter: string | null;
  clubs: ClubRow[];
  onOpenSwingConfig: () => void;
}) {
  const clubName = useMemo(() => Object.fromEntries(clubs.map((c) => [c.id, c.name])), [clubs]);

  const testTelegram = async () => {
    if (!clubFilter) { toast.error("Vui lòng chọn CLB trước"); return; }
    const msg = `🧪 Test từ VBacker Swing Manager\nCLB: ${clubName[clubFilter] ?? clubFilter}\nThời gian: ${new Date().toLocaleString("vi-VN")}`;
    const { error } = await supabase.functions.invoke("telegram-swing-notifier", {
      body: { chat_id: "__club__", message: msg, club_id: clubFilter },
    });
    if (error) toast.error(error.message);
    else toast.success("Đã gửi test Telegram");
  };

  return (
    <Card className="p-3 h-full">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="w-4 h-4 text-primary" />
        <span className="font-display text-sm tracking-wider">ĐÀI CHỈ HUY</span>
      </div>

      {/* Quick Actions */}
      <div className="space-y-2 mb-4">
        <Button size="sm" className="w-full justify-start text-xs" onClick={onAutoSwing} disabled={swingAllBusy}>
          {swingAllBusy ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-2" />}
          Auto-Swing All
        </Button>
        <Button size="sm" variant="outline" className="w-full justify-start text-xs" onClick={testTelegram}>
          <Send className="w-3 h-3 mr-2" /> Gửi Telegram test
        </Button>
        <Button size="sm" variant="outline" className="w-full justify-start text-xs" onClick={onExportShift}>
          <FileSpreadsheet className="w-3 h-3 mr-2" /> Xuất báo cáo ca
        </Button>
        <Button size="sm" variant="outline" className="w-full justify-start text-xs" onClick={onExportPayroll}>
          <DollarSign className="w-3 h-3 mr-2" /> Xuất bảng lương
        </Button>
        <Button size="sm" variant="outline" className="w-full justify-start text-xs" onClick={onOpenSwingConfig}>
          <Settings className="w-3 h-3 mr-2" /> Cấu hình Swing
        </Button>
      </div>

      {/* Audit Log Feed */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-2">NHẬT KÝ HOẠT ĐỘNG</div>
        <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
          {auditLogs.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">Chưa có hoạt động.</div>
          ) : (
            auditLogs.map((log: any) => (
              <div key={log.id} className="text-[11px] text-muted-foreground border-l-2 border-border pl-2 py-0.5">
                <span className="font-semibold text-foreground">{log.action}</span>
                <span className="block truncate">{new Date(log.created_at).toLocaleTimeString("vi-VN")}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}

/* ==============================================================
   TIMER CELL — self-updating countdown (1s interval, no parent re-render)
   ============================================================== */
function TimerCell({ assignedAt, swingDuration, warnAt, critAt }: {
  assignedAt: string;
  swingDuration: number;
  warnAt: number;
  critAt: number;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = (now - new Date(assignedAt).getTime()) / (1000 * 60);
  const timeLeft = Math.max(0, swingDuration - elapsed);
  const m = Math.floor(timeLeft);
  const s = Math.floor((timeLeft - m) * 60);

  let color = "text-primary";
  if (timeLeft <= critAt) color = "text-red-500";
  else if (timeLeft <= warnAt) color = "text-amber-500";

  return (
    <div className={`font-mono text-lg font-bold ${color}`}>
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </div>
  );
}

/* ==============================================================
   TIER BADGE
   ============================================================== */
function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    A: "bg-yellow-500/20 text-yellow-500 border-yellow-500/40",
    B: "bg-slate-400/20 text-slate-400 border-slate-400/40",
    C: "bg-amber-700/20 text-amber-700 border-amber-700/40",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 border font-bold ${colors[tier] ?? colors.C} rounded-none`}>
      {tier}
    </span>
  );
}

/* ==============================================================
   TABLE TYPE BADGE
   ============================================================== */
function TableTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    cash: "Cash",
    tournament: "Tournament",
    vip: "VIP",
  };
  const colors: Record<string, string> = {
    cash: "bg-primary/10 text-primary border-primary/30",
    tournament: "bg-blue-500/10 text-blue-500 border-blue-500/30",
    vip: "bg-purple-500/10 text-purple-500 border-purple-500/30",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 border font-semibold ${colors[type] ?? colors.cash} rounded-none`}>
      {labels[type] ?? type}
    </span>
  );
}

/* ==============================================================
   SWING CONFIG DIALOG
   ============================================================== */
function SwingConfigDialog({ open, onOpenChange, clubId, currentConfigs, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clubId: string;
  currentConfigs: SwingConfig[];
  onSaved: () => void;
}) {
  const defaultForm = useCallback(() => ({
    cash: { swing_duration_minutes: 45, break_duration_minutes: 20, warn_at_minutes: 5, crit_at_minutes: 1, tournament_mode: "time" },
    tournament: { swing_duration_minutes: 30, break_duration_minutes: 20, warn_at_minutes: 5, crit_at_minutes: 1, tournament_mode: "time" },
    vip: { swing_duration_minutes: 45, break_duration_minutes: 20, warn_at_minutes: 5, crit_at_minutes: 1, tournament_mode: "time" },
  }), []);

  const [form, setForm] = useState<Record<string, typeof defaultForm.cash>>(defaultForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next = defaultForm();
    for (const cfg of currentConfigs) {
      if (next[cfg.table_type]) {
        next[cfg.table_type] = {
          swing_duration_minutes: cfg.swing_duration_minutes,
          break_duration_minutes: cfg.break_duration_minutes,
          warn_at_minutes: cfg.warn_at_minutes,
          crit_at_minutes: cfg.crit_at_minutes,
          tournament_mode: (cfg as any).tournament_mode ?? "time",
        };
      }
    }
    setForm(next);
  }, [open, currentConfigs, defaultForm]);

  const update = (type: string, field: string, value: number | string) => {
    setForm((prev) => ({ ...prev, [type]: { ...prev[type], [field]: value } }));
  };

  const save = async () => {
    if (!clubId) { toast.error("Vui lòng chọn CLB"); return; }
    setSaving(true);
    const types = ["cash", "tournament", "vip"];
    for (const t of types) {
      const vals = form[t];
      if (!vals) continue;
      const { error } = await supabase.from("swing_config").upsert({
        club_id: clubId,
        table_type: t,
        swing_duration_minutes: vals.swing_duration_minutes,
        break_duration_minutes: vals.break_duration_minutes,
        warn_at_minutes: vals.warn_at_minutes,
        crit_at_minutes: vals.crit_at_minutes,
        tournament_mode: t === "tournament" ? vals.tournament_mode : "time",
      }, { onConflict: "club_id, table_type" });
      if (error) { toast.error(`Lỗi lưu ${t}: ${error.message}`); setSaving(false); return; }
    }
    setSaving(false);
    toast.success("Đã lưu cấu hình Swing");
    onSaved();
    onOpenChange(false);
  };

  const section = (label: string, type: string) => {
    const v = form[type];
    if (!v) return null;
    const isTournament = type === "tournament";
    return (
      <div key={type} className="mb-4">
        <div className="text-xs font-display tracking-wider text-muted-foreground border-b border-border pb-1 mb-3 uppercase">
          {label}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <Label className="text-[11px]">Swing Duration (min)</Label>
            <Input type="number" min={1} max={240}
              className="h-8 font-mono text-xs"
              value={v.swing_duration_minutes}
              onChange={(e) => update(type, "swing_duration_minutes", Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-[11px]">Break Duration (min)</Label>
            <Input type="number" min={1} max={120}
              className="h-8 font-mono text-xs"
              value={v.break_duration_minutes}
              onChange={(e) => update(type, "break_duration_minutes", Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-[11px]">Warning Threshold (min)</Label>
            <Input type="number" min={0} max={60}
              className="h-8 font-mono text-xs"
              value={v.warn_at_minutes}
              onChange={(e) => update(type, "warn_at_minutes", Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-[11px]">Critical Threshold (min)</Label>
            <Input type="number" min={0} max={60}
              className="h-8 font-mono text-xs"
              value={v.crit_at_minutes}
              onChange={(e) => update(type, "crit_at_minutes", Number(e.target.value))} />
          </div>
          {isTournament && (
            <div>
              <Label className="text-[11px]">Tournament Mode</Label>
              <Select value={v.tournament_mode} onValueChange={(val) => update(type, "tournament_mode", val)}>
                <SelectTrigger className="h-8 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="time">Time (fixed minutes)</SelectItem>
                  <SelectItem value="level">Level (per blind level)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>
    );
  };

  const clubName = (() => {
    // We don't have clubs prop here, just show "Cấu hình Swing" as title
    return "";
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cấu hình Swing</DialogTitle>
          <DialogDescription>Điều chỉnh thông số swing cho từng loại bàn.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {section("Cash", "cash")}
          {section("Tournament", "tournament")}
          {section("VIP", "vip")}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
            Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ==============================================================
   STATUS PILL
   ============================================================== */
function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    "Sẵn sàng": "bg-emerald-500/20 text-emerald-500",
    "Đang bàn": "bg-blue-500/20 text-blue-500",
    "Đang nghỉ": "bg-amber-500/20 text-amber-500",
  };
  return (
    <span className={`text-[10px] px-1.5 py-[1px] font-medium ${colors[status] ?? "bg-muted text-muted-foreground"} rounded-none`}>
      {status}
    </span>
  );
}
