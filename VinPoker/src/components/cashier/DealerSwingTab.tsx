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
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  useCheckedInDealers, useActiveTables, useActiveAssignmentsWithTimeline, useSwingConfigs, useAuditLogs,
  useSwingMetrics, useBreakPolicies, useSpecialDates, useAvailableTables, usePreAssignedDealers, usePoolTables,
  useOptimisticDealerCount, useNextDealerPredictions, useTodayCheckedOutDealers,
} from "@/hooks/useDealerSwing";
import type { DealerAssignment, DealerAttendance, SwingConfig, ShiftBreakPolicy, PreAssignedInfo, NextDealerPrediction } from "@/hooks/useDealerSwing";
import { useActiveTournaments } from "@/hooks/useTournaments";
import type { TournamentWithTables } from "@/types/tournament";
import { NextDealerPreview } from "./NextDealerPreview";
import { useAllDealers, useDealerScores } from "@/hooks/useDealerManagement";
import { useSwingAnimation } from "@/hooks/useSwingAnimation";
import DealerManagementTab from "./DealerManagementTab";
import { TableTimerDisplay } from "./TableTimerDisplay";
import { TableCardKebab } from "./TableCardKebab";
import { exportToExcel } from "@/lib/exportExcel";
import {
  Users,   Table2, Bell, Play, RefreshCw, UserPlus, UserMinus,
  Send, FileSpreadsheet, DollarSign, Loader2, Clock, AlertTriangle,
  Plus, MessageCircle, Save, Settings, Trash2, Calendar as CalendarIcon, Zap, LayoutDashboard,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

type ClubRow = { id: string; name: string };
type Tour = { id: string; club_id: string; tour_name: string; start_time: string; end_time: string; tour_tier?: string };

function useTours(clubIds: string[]) {
  const [data, setData] = useState<Tour[] | null>(null);
  const [loading, setLoading] = useState(false);
  const genRef = useRef(0);
  const clubIdsKey = useMemo(() => [...clubIds].sort().join(","), [clubIds]);
  const load = useCallback(async () => {
    const gen = ++genRef.current;
    if (!clubIds.length) { if (gen === genRef.current) setData([]); return; }
    setLoading(true);
    const { data: d } = await supabase.from("dealer_shifts").select("*").in("club_id", clubIds).order("start_time");
    if (gen !== genRef.current) return;
    setData(d ?? []); setLoading(false);
  }, [clubIdsKey]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, refetch: load };
}

/* ==============================================================
   SWING PANEL — Main 3-Column Layout
   ============================================================== */
export default function SwingPanel({ clubIds, clubs }: { clubIds: string[]; clubs: ClubRow[] }) {
  const [clubFilter, setClubFilter] = useState<string | null>(clubIds.length === 1 ? clubIds[0] : null);
  const filteredClubIds = useMemo(() => {
    const ids = clubFilter ? [clubFilter] : clubIds;
    return [...ids].sort();
  }, [clubFilter, clubIds]);
  const [selectedTour, setSelectedTour] = useState<string | null>(null);

  const { data: dealers, loading: dealersLoading, error: dealersError, refetch: refetchDealers } = useCheckedInDealers(filteredClubIds);
  const { data: checkedOutDealers, refetch: refetchCheckedOut } = useTodayCheckedOutDealers(filteredClubIds);
  const { data: allDealers } = useAllDealers(filteredClubIds);
  const { data: tables, loading: tablesLoading, error: tablesError, refetch: refetchTables } = useActiveTables(filteredClubIds);
  const { data: availableTables, error: availableTablesError, refetch: refetchAvailableTables } = useAvailableTables(filteredClubIds);
  const { data: poolTables, loading: poolLoading, error: poolError, refetch: refetchPoolTables } = usePoolTables(filteredClubIds);
  const { data: assignments, loading: assignsLoading, refetch: refetchAssignments } = useActiveAssignmentsWithTimeline(filteredClubIds);
  const preAssignedMap = usePreAssignedDealers(assignments);
  const { data: swingConfigs, refetch: refetchSwingConfigs } = useSwingConfigs(filteredClubIds);

  const timelineByTableId = useMemo(() => {
    const map: Record<string, { minutesLeft: number; showNextDealerSoon: boolean; isOverdue: boolean }> = {};
    for (const a of assignments ?? []) {
      map[a.table_id] = {
        minutesLeft: (a as any).minutesLeft ?? 0,
        showNextDealerSoon: (a as any).showNextDealerSoon ?? false,
        isOverdue: (a as any).isOverdue ?? false,
      };
    }
    return map;
  }, [assignments]);
  const { data: swingMetrics } = useSwingMetrics(filteredClubIds);
  const breakPolicies = useBreakPolicies(filteredClubIds);
  const { data: specialDates, refetch: refetchSpecialDates } = useSpecialDates(filteredClubIds);
  const auditLogs = useAuditLogs(filteredClubIds, 15);
  const { data: tours, refetch: refetchTours } = useTours(filteredClubIds);
  const { optimistic: checkedInCount, onCheckout: onOptCheckout } = useOptimisticDealerCount(dealers?.length ?? 0);
  const { data: nextDealerMap } = useNextDealerPredictions(filteredClubIds);

  // ── Tournament config for swing override display ─────────────────────────
  const { data: tournaments } = useActiveTournaments(
    clubFilter ?? filteredClubIds[0]
  );

  const [processing, setProcessing] = useState<string | null>(null);
  const [swingAllBusy, setSwingAllBusy] = useState(false);
  const [massAssignBusy, setMassAssignBusy] = useState(false);
  const [autoSwingEnabled, setAutoSwingEnabled] = useState(false);
  const [activeView, setActiveView] = useState<"roster" | "tables" | "dealers">("tables");
  const [modalTable, setModalTable] = useState<string | null>(null);
  const [manualDealerId, setManualDealerId] = useState<string>("");
  const [suggestions, setSuggestions] = useState<any[] | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinDealerIds, setCheckinDealerIds] = useState<string[]>([]);
  const [checkinDealers, setCheckinDealers] = useState<any[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutAttendanceId, setCheckoutAttendanceId] = useState("");
  // Pool-based table creation state
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [poolSearch, setPoolSearch] = useState("");
  const [selectedPoolTableIds, setSelectedPoolTableIds] = useState<string[]>([]);
  const [newTableType, setNewTableType] = useState("tournament");

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
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollDatePreset, setPayrollDatePreset] = useState<"today" | "month" | "custom">("month");
  const [payrollFromDate, setPayrollFromDate] = useState<Date>(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const [payrollToDate, setPayrollToDate] = useState<Date>(new Date());
  const [payrollEdits, setPayrollEdits] = useState<Record<string, { adjustedHours?: number; adjustedRate?: number }>>({});
  const [payrollEditDealer, setPayrollEditDealer] = useState<string | null>(null);

  const recalcPay = (row: any, edits: { adjustedHours?: number; adjustedRate?: number }) => {
    const hours = edits.adjustedHours ?? row.total_hours;
    const rate = edits.adjustedRate ?? row.hourly_rate_vnd;
    const isPT = row.employment_type === "part_time";
    const basePay = isPT ? hours * rate : (row.base_rate_vnd ?? hours * rate);
    const otPay = (row.overtime_minutes ?? 0) / 60 * rate * 1.5;
    return { ...row, total_hours: hours, hourly_rate_vnd: rate, base_pay: Math.round(basePay), overtime_pay: Math.round(otPay), total_pay: Math.round(basePay + otPay) };
  };

  // Batch checkout confirm dialog
  const [batchCheckoutConfirmOpen, setBatchCheckoutConfirmOpen] = useState(false);
  const [batchCheckoutWarnings, setBatchCheckoutWarnings] = useState<string[]>([]);
  const [batchCheckoutPending, setBatchCheckoutPending] = useState<string[]>([]);

  // Close table confirmation
  const [closeTableConfirmId, setCloseTableConfirmId] = useState<string | null>(null);
  const [closingTable, setClosingTable] = useState(false);

  // Special dates dialog
  const [specialDatesOpen, setSpecialDatesOpen] = useState(false);
  const [sdForm, setSdForm] = useState({ date: "", label: "", multiplier: "1.5" });
  const [sdSaving, setSdSaving] = useState(false);

  // Create tour state
  const [createTourOpen, setCreateTourOpen] = useState(false);
  const [newTourName, setNewTourName] = useState("");
  const [newTourStartTime, setNewTourStartTime] = useState("");
  const [newTourEndTime, setNewTourEndTime] = useState("");

  // Load auto_swing_enabled setting
  useEffect(() => {
    const cid = clubFilter || filteredClubIds[0];
    if (!cid) return;
    (async () => {
      const { data } = await supabase
        .from("club_settings")
        .select("auto_swing_enabled")
        .eq("club_id", cid)
        .maybeSingle();
      setAutoSwingEnabled((data as any)?.auto_swing_enabled ?? false);
    })();
  }, [clubFilter, filteredClubIds[0]]);

  // When switching to a tour with no tables, force auto-swing OFF
  useEffect(() => {
    if (!selectedTour || !tables) return;
    const hasTables = tables.some(t => t.shift_id === selectedTour);
    if (!hasTables) setAutoSwingEnabled(false);
  }, [selectedTour, tables]);

  // Toggle auto-swing
  const toggleAutoSwing = async () => {
    const cid = clubFilter || filteredClubIds[0];
    if (!cid) return;
    const next = !autoSwingEnabled;
    const { error } = await supabase
      .from("club_settings")
      .upsert({ club_id: cid, auto_swing_enabled: next }, { onConflict: "club_id" });
    if (error) { toast.error(error.message); return; }
    setAutoSwingEnabled(next);
    toast.success(next ? "Auto-swing đã bật" : "Auto-swing đã tắt");
    if (next) {
      const result = await massAssign();
      await refetchAssignments();
      if (result === 0 && tables?.some(t => t.shift_id === selectedTour)) {
        const freshTableAssignmentMap = Object.fromEntries(
          (assignments ?? []).filter(a => a.status === "assigned").map(a => [a.table_id, a])
        );
        const hasEmptyTable = tables.some(t => t.shift_id === selectedTour && !freshTableAssignmentMap[t.id]);
        if (hasEmptyTable) {
          toast.warning("Không có dealer khả dụng cho bàn trống — cron sẽ retry sau");
        }
      }
      try { await autoSwingAll(cid, selectedTour); }
      catch (e) { console.error("[toggleAutoSwing] autoSwingAll failed", e); }
    }
  };

  const { user } = useAuth();

  const isSubmitting = useRef(false);

  // INVARIANT: Must use `status === "assigned"` NOT `status !== "completed"`.
  // dealer_assignments has status values: assigned, completed, on_break, swing_skipped.
  // Using `!== "completed"` would match `on_break` records, and since .find() returns
  // the first match (ordered by assigned_at ASC), old on_break assignments would shadow
  // newer assigned ones — causing the UI to show a stale dealer on the table.
  // See https://github.com/PhamGiaVinh/-vinpoker-/issues/... -- 2026-05-29 regression
  const tableAssignmentMap = useMemo(() => {
    const map: Record<string, DealerAssignment | null> = {};
    for (const t of tables ?? []) {
      const a = (assignments ?? []).find((a) => a.table_id === t.id && a.status === "assigned");
      map[t.id] = a ?? null;
    }
    return map;
  }, [tables, assignments]);

  // Get swing config for a table
  const getConfig = (tableType: string): SwingConfig | undefined =>
    swingConfigs?.find((c) => (clubFilter ? c.club_id === clubFilter : true) && c.table_type === tableType);

  // Trigger auto-swing all
  const autoSwingAll = async (clubId?: string | null, shiftId?: string | null) => {
    setSwingAllBusy(true);
    try {
      if (!clubId) clubId = clubFilter ?? filteredClubIds[0];
      if (!clubId) { toast.error("Vui lòng chọn CLB"); setSwingAllBusy(false); return; }
      const body: Record<string, any> = { manual_trigger: true };
      if (clubId) body.club_id = clubId;
      if (shiftId) body.shift_id = shiftId;
      const { data, error } = await supabase.functions.invoke("process-swing", { body });
      if (error) {
        const ctx = (error as any)?.context;
        let detail = `Lỗi ${ctx?.status ?? '?'}`;
        try {
          const respBody = await ctx?.text?.();
          if (respBody) detail += `: ${respBody}`;
        } catch { /* ignore */ }
        toast.error(detail);
        console.error("[autoSwingAll]", detail, error);
        return;
      }
      toast.success(`Đã xử lý ${(data as any)?.processed_count ?? 0} swing`);
      await Promise.all([
        refetchAssignments(),
        refetchTables(),
        refetchDealers(),
      ]);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSwingAllBusy(false);
    }
  };

  // Mass assign: fill empty tables. Returns assigned count.
  const massAssign = async (): Promise<number> => {
    const cid = clubFilter || filteredClubIds[0];
    if (!cid) { toast.error("Vui lòng chọn CLB"); return 0; }
    setMassAssignBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mass-assign", {
        body: { club_id: cid, shift_id: selectedTour ?? undefined },
      });
      if (error) {
        const ctx = (error as any)?.context;
        let detail = `Lỗi ${ctx?.status ?? '?'}`;
        try { const rb = await ctx?.text?.(); if (rb) detail += `: ${rb}`; } catch {}
        toast.error(detail);
        console.error("[massAssign]", detail, error);
        return 0;
      }
      const r = data as any;
      toast.success(`Đã gán ${r.assigned ?? 0} bàn trống`);
      await Promise.all([
        refetchAssignments(),
        refetchDealers(),
      ]);
      return r.assigned ?? 0;
    } catch (e: any) {
      toast.error(e.message);
      return 0;
    } finally {
      setMassAssignBusy(false);
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
      if (modalTable) triggerSwingAnimation(modalTable);
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
        body: { attendance_id: attendanceId, action: "start", requested_by: user?.id, club_id: clubFilter ?? filteredClubIds[0] },
      });
      if (error) { toast.error(error.message); return; }
      toast.success("Đã gửi dealer đi nghỉ");
      // Telegram notification
      const breakDealer = (dealers ?? []).find((d) => d.id === attendanceId);
      const breakName = breakDealer?.dealers?.full_name ?? "";
      const breakEnd = new Date(Date.now() + 15 * 60000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      const tourName = getTourName();
      // fire-and-forget — never block UX, never show toast error
      sendTelegram(`☕ ${breakName} bắt đầu nghỉ${tourName ? ` (Tour: ${tourName})` : ""}. Dự kiến quay lại lúc: ${breakEnd}.`)
        .catch(() => {});
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

  // Close table with dealer cleanup
  const closeTable = async () => {
    if (!closeTableConfirmId) return;
    setClosingTable(true);
    try {
      const { data, error } = await supabase.functions.invoke("close-table", {
        body: { table_id: closeTableConfirmId, requested_by: user?.id },
      });
      if (error) {
        let detail = error.message;
        try { const b = await (error as any).context?.json(); detail = b?.error ?? detail; } catch {}
        toast.error(`Lỗi đóng bàn: ${detail}`);
        return;
      }
      const r = data as any;
      if (r.had_dealer) {
        toast.success("Đã đóng bàn và chuyển dealer sang break");
      } else {
        toast.success("Đã đóng bàn");
      }
      setCloseTableConfirmId(null);
      refetchTables();
      refetchAssignments();
      refetchDealers();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setClosingTable(false);
    }
  };

  // Send Telegram notification — fire-and-forget, silent fail
  const sendTelegram = async (message: string) => {
    const clubId = clubFilter ?? filteredClubIds[0];
    if (!clubId) return;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const { error } = await supabase.functions.invoke("telegram-swing-notifier", {
        body: { chat_id: "__club__", message, club_id: clubId },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (error) console.warn("[sendTelegram] Error:", error);
    } catch {
      // timeout or network error — non-critical, silent fail
    }
  };

  // Get current tour name
  const getTourName = () => {
    if (!selectedTour) return "";
    const tour = (tours ?? []).find((t) => t.id === selectedTour);
    return tour ? tour.tour_name : "";
  };

  // Load dealers for manual check-in — includes checked-out dealers (re-check-in) in separate section
  const loadCheckinDealers = async () => {
    const today = new Date().toISOString().split("T")[0];
    const { data: activeDealers } = await supabase
      .from("dealers")
      .select("id, full_name, tier, club_id")
      .in("club_id", filteredClubIds)
      .eq("status", "active")
      .order("full_name");
    const dealerMap = new Map((activeDealers ?? []).map((d) => [d.id, d]));

    // Also fetch checked-out dealers today — they might not be in the active dealers list
    const { data: checkedOutToday } = await supabase
      .from("dealer_attendance")
      .select("dealer_id, dealers!inner(full_name, tier)")
      .in("dealers.club_id", filteredClubIds)
      .eq("status", "checked_out")
      .eq("shift_date", today);
    for (const co of checkedOutToday ?? []) {
      if (!dealerMap.has(co.dealer_id)) {
        const dd = (co as any).dealers;
        dealerMap.set(co.dealer_id, { id: co.dealer_id, full_name: dd?.full_name ?? "?", tier: dd?.tier ?? "C", club_id: "" });
      }
    }

    const dealerIds = [...dealerMap.keys()];
    if (!dealerIds.length) { setCheckinDealers([]); return; }

    // Exclude currently checked-in dealers
    const { data: activeAtt } = await supabase
      .from("dealer_attendance")
      .select("dealer_id")
      .in("dealer_id", dealerIds)
      .eq("status", "checked_in")
      .in("current_state", ["available", "assigned", "on_break", "pre_assigned"]);
    const activeCheckedInIds = new Set((activeAtt ?? []).map((a) => a.dealer_id));
    // Also exclude dealers with active table assignments
    const { data: activeAssigns } = await supabase
      .from("dealer_assignments")
      .select("dealer_id")
      .eq("status", "assigned")
      .in("dealer_id", dealerIds);
    for (const a of activeAssigns ?? []) activeCheckedInIds.add(a.dealer_id);

    // Get today's attendance to classify: checked-out → re-check-in, no attendance → new check-in
    const { data: todayAtt } = await supabase
      .from("dealer_attendance")
      .select("dealer_id, status")
      .eq("shift_date", today)
      .in("dealer_id", dealerIds);
    const checkedOutIds = new Set(
      (todayAtt ?? []).filter((a) => a.status === "checked_out").map((a) => a.dealer_id)
    );
    const withAttToday = new Set((todayAtt ?? []).map((a) => a.dealer_id));

    const reCheckins: any[] = [];
    const newCheckins: any[] = [];
    for (const id of dealerIds) {
      if (activeCheckedInIds.has(id)) continue;
      const d = dealerMap.get(id)!;
      if (checkedOutIds.has(id)) {
        reCheckins.push({ ...d, wasCheckedOut: true });
      } else if (!withAttToday.has(id)) {
        newCheckins.push({ ...d, wasCheckedOut: false });
      }
      // skip if dealer has today attendance but not checked_out (e.g. stale checked_in)
    }
    setCheckinDealers([...reCheckins, ...newCheckins]);
  };

  // Manual check-in multiple dealers
  // INSERT new record instead of UPDATE — preserves history for payroll.
  // Partial unique index idx_one_active_checkin_per_dealer prevents
  // double active check-in (dealer_id, shift_date WHERE status='checked_in').
  const doCheckin = async () => {
    if (!checkinDealerIds.length) return;
    setProcessing("checkin");
    const today = new Date().toISOString().split("T")[0];
    const { data: shifts } = await supabase
      .from("dealer_shifts")
      .select("id")
      .in("club_id", filteredClubIds)
      .order("start_time")
      .limit(1);
    const shiftId = (shifts ?? [])[0]?.id;
    let success = 0, fail = 0;

    for (const dealerId of checkinDealerIds) {
      // Idempotency: skip if dealer already actively checked in today
      const { data: activeCheckin } = await supabase
        .from("dealer_attendance")
        .select("id, check_in_time")
        .eq("dealer_id", dealerId)
        .eq("shift_date", today)
        .eq("status", "checked_in")
        .maybeSingle();
      if (activeCheckin) {
        console.warn(`[doCheckin] Dealer ${dealerId} already checked in at ${activeCheckin.check_in_time} — skip`);
        continue;
      }
      // INSERT new attendance record; the old checked_out record is preserved
      const { error } = await supabase.from("dealer_attendance").insert({
        dealer_id: dealerId,
        shift_id: shiftId ?? null,
        shift_date: today,
        status: "checked_in",
        current_state: "available",
        check_in_time: new Date().toISOString(),
      });
      if (error) {
        // 23505 = unique_violation from idx_one_active_checkin_per_dealer
        if (error.code === "23505") {
          console.warn(`[doCheckin] Dealer ${dealerId} checked in concurrently — skip`);
          success++;
          continue;
        }
        fail++;
        continue;
      }
      success++;
    }
    setProcessing(null);
    if (fail > 0) toast.warning(`Check-in: ${success} thành công, ${fail} thất bại`);
    else toast.success(`Đã check-in ${success} dealer`);
    setCheckinOpen(false);
    setCheckinDealerIds([]);
    refetchDealers();
  };

  // Quick re-check-in for checked-out dealers (from the "Đã check-out" section)
  // INSERT new record instead of UPDATE — the old checked_out record is
  // preserved so payroll (get_dealer_payroll) can compute hours from history.
  const doReCheckin = async (dealerId: string) => {
    setProcessing("checkin");
    const today = new Date().toISOString().split("T")[0];
    try {
      // Idempotency: skip if dealer already actively checked in today
      const { data: activeCheckin } = await supabase
        .from("dealer_attendance")
        .select("id, check_in_time")
        .eq("dealer_id", dealerId)
        .eq("shift_date", today)
        .eq("status", "checked_in")
        .maybeSingle();
      if (activeCheckin) {
        console.warn(`[doReCheckin] Dealer ${dealerId} already active since ${activeCheckin.check_in_time} — skip`);
        toast.info("Dealer đang trong ca rồi");
        setProcessing(null);
        return;
      }
      // Get the latest checked-out record to reuse its shift_id
      const { data: lastCheckout } = await supabase
        .from("dealer_attendance")
        .select("shift_id")
        .eq("dealer_id", dealerId)
        .eq("shift_date", today)
        .eq("status", "checked_out")
        .order("check_out_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      // INSERT new attendance record
      const { error } = await supabase.from("dealer_attendance").insert({
        dealer_id: dealerId,
        shift_id: lastCheckout?.shift_id ?? null,
        shift_date: today,
        status: "checked_in",
        current_state: "available",
        check_in_time: new Date().toISOString(),
      });
      if (error) {
        if (error.code === "23505") {
          console.warn(`[doReCheckin] Race condition — dealer ${dealerId} checked in concurrently`);
          toast.info("Dealer đã check-in rồi");
          setProcessing(null);
          return;
        }
        throw error;
      }
      setProcessing(null);
      toast.success("Đã check-in lại dealer");
      refetchDealers();
      refetchCheckedOut();
    } catch (e: any) {
      setProcessing(null);
      toast.error(`Re-check-in thất bại: ${e.message}`);
    }
  };

  // ── Special Dates CRUD handlers (Bug 6) ─────────────────────────────────
  async function handleAddSpecialDate() {
    if (!sdForm.date) { toast.error("Vui lòng chọn ngày"); return; }
    const mult = parseFloat(sdForm.multiplier);
    if (isNaN(mult) || mult <= 0 || mult > 10) {
      toast.error("Multiplier phải là số dương (VD: 1.5, 2.0)");
      return;
    }
    setSdSaving(true);
    try {
      const { error } = await supabase.from("special_dates").insert({
        club_id: clubFilter ?? filteredClubIds[0],
        date: sdForm.date,
        label: sdForm.label.trim() || null,
        multiplier: mult,
      });
      if (error) throw error;
      setSdForm({ date: "", label: "", multiplier: "1.5" });
      await refetchSpecialDates();
      toast.success("Đã thêm ngày đặc biệt");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Lỗi không xác định";
      toast.error(`Thêm thất bại: ${msg}`);
    } finally { setSdSaving(false); }
  }

  async function handleDeleteSpecialDate(id: string, label: string) {
    if (!confirm(`Xóa ngày đặc biệt "${label || id}"?`)) return;
    const { error } = await supabase.from("special_dates").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await refetchSpecialDates();
    toast.success("Đã xóa");
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Manual check-out via edge function (with pre_assigned cleanup)
  const doCheckout = async () => {
    if (!checkoutAttendanceId) return;
    setProcessing("checkout");
    const { data, error } = await supabase.functions.invoke("checkout-dealer", {
      body: { attendance_id: checkoutAttendanceId },
    });
    setProcessing(null);
    if (error) {
      let detail = error.message || "Lỗi check-out dealer";
      try {
        const ctx = (error as any)?.context;
        if (ctx?.json) {
          const body = await ctx.json();
          if (body?.error) detail = body.error;
        }
      } catch { /* ignore */ }
      toast.error(detail);
      return;
    }
    if (data?.released_pre_assigned) {
      toast.warning(`Dealer đang pre_assigned cho bàn ${data.pre_assigned_table ?? "?"} được release`);
    }
    toast.success("Đã check-out dealer");
    setCheckoutOpen(false);
    onOptCheckout();
    setTimeout(refetchDealers, 50);
  };

  // Batch checkout with pre-check for active assignments
  const handleBatchCheckoutClick = async (attendanceIds: string[]) => {
    if (!attendanceIds.length) return;

    const { data: active } = await supabase
      .from("dealer_assignments")
      .select(`
        attendance_id,
        status,
        game_tables!inner(table_name)
      `)
      .in("attendance_id", attendanceIds)
      .in("status", ["assigned", "pre_assigned"]);

    const activeMap = new Map<string, { tableName: string; status: string }>();
    for (const a of active ?? []) {
      const aa = a as any;
      activeMap.set(aa.attendance_id, {
        tableName: aa.game_tables?.table_name ?? "?",
        status: aa.status,
      });
    }

    if (activeMap.size > 0) {
      const warnings: string[] = [];
      for (const id of attendanceIds) {
        const info = activeMap.get(id);
        if (info) {
          const dealerEntry = (dealers ?? []).find((d: any) => d.id === id);
          const dealerName = (dealerEntry as any)?.dealers?.full_name ?? id;
          const statusLabel = info.status === "pre_assigned" ? "đang pre-assign" : "đang ở bàn";
          warnings.push(`${dealerName} — ${statusLabel} ${info.tableName}`);
        }
      }
      if (warnings.length > 0) {
        setBatchCheckoutWarnings(warnings);
        setBatchCheckoutPending(attendanceIds);
        setBatchCheckoutConfirmOpen(true);
        return;
      }
    }

    // No active assignments — proceed directly
    await doBatchCheckout(attendanceIds);
  };

  // Batch checkout via edge function
  const doBatchCheckout = async (ids: string[]) => {
    if (!ids.length) return;
    setProcessing("checkout");
    try {
      const { data, error } = await supabase.functions.invoke("checkout-dealer", {
        body: { attendance_ids: ids },
      });
      if (error) {
        let detail = error.message || "Lỗi checkout hàng loạt";
        try {
          const ctx = (error as any)?.context;
          if (ctx?.json) {
            const body = await ctx.json();
            if (body?.error) detail = body.error;
          }
        } catch { /* ignore */ }
        toast.error(detail);
        return;
      }
      const results = (data as any)?.results ?? [];
      const successCount = results.filter((r: any) => r.success).length;
      if (successCount > 0) {
        toast.success(`Đã checkout ${successCount}/${ids.length} dealer`);
      }
      if (successCount < ids.length) {
        const failed = results.filter((r: any) => !r.success);
        toast.error(`${failed.length} dealer thất bại`);
      }
      onOptCheckout(successCount);
      setTimeout(refetchDealers, 50);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProcessing(null);
    }
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

  // Payroll: fetch dealer_scores + today's attendance + pay rates
  const payrollDateBounds = useMemo(() => {
    let from: string, to: string;
    const today = new Date();
    if (payrollDatePreset === "today") {
      from = to = today.toISOString().split("T")[0];
    } else if (payrollDatePreset === "month") {
      from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];
      to = today.toISOString().split("T")[0];
    } else {
      from = payrollFromDate.toISOString().split("T")[0];
      to = payrollToDate.toISOString().split("T")[0];
    }
    return { from, to };
  }, [payrollDatePreset, payrollFromDate, payrollToDate]);

  const openPayroll = async () => {
    if (!clubFilter && clubIds.length > 1) {
      toast.error("Vui lòng chọn một CLB trước khi xem lương");
      return;
    }
    const clubId = clubFilter ?? clubIds[0];
    setPayrollLoading(true);
    setPayrollOpen(true);
    await loadPayrollData(clubId);
  };

  const loadPayrollData = async (clubId: string) => {
    setPayrollLoading(true);
    const { from, to } = payrollDateBounds;
    const { data: club } = await supabase.from("clubs").select("slug").eq("id", clubId).single();
    const { data, error } = await supabase.rpc("get_dealer_payroll", {
      p_club_id: clubId,
      p_from_date: from,
      p_to_date: to,
    });
    setPayrollLoading(false);
    if (error) { toast.error(error.message); return; }
    setPayrollData((data ?? []) as any[]);
    setPayrollClubSlug((club as any)?.slug ?? "club");
  };

  const reloadPayroll = async () => {
    const clubId = clubFilter ?? clubIds[0];
    if (!clubId) return;
    await loadPayrollData(clubId);
  };

  const doExportPayrollCsv = () => {
    if (!payrollData?.length) return;
    const today = new Date().toISOString().split("T")[0];
    const label = `${payrollClubSlug}-${payrollDateBounds.from}-${payrollDateBounds.to}`;
    exportToExcel(`bang-luong-${label}-${today}`, payrollData.map((r: any) => {
      const edits = payrollEdits[r.dealer_id] ?? {};
      const displayRow = recalcPay(r, edits);
      return {
        "Dealer": r.full_name,
        "Hạng": r.tier,
        "Loại": r.employment_type === "part_time" ? "Part-time" : "Full-time",
        "Tổng giờ": displayRow.total_hours,
        "OT phút": r.overtime_minutes,
        "Số swing": r.total_swings,
        "Giờ (VND)": Number(displayRow.hourly_rate_vnd).toLocaleString("vi-VN"),
        "Lương CB": Number(displayRow.base_pay).toLocaleString("vi-VN"),
        "Lương OT": Number(displayRow.overtime_pay).toLocaleString("vi-VN"),
        "Tổng lương": Number(displayRow.total_pay).toLocaleString("vi-VN"),
      };
    }));
    toast.success("Đã tải bảng lương");
  };

  const { triggerSwingAnimation, isAnimating } = useSwingAnimation();

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
        <Button size="sm" variant={activeView === "dealers" ? "default" : "outline"} onClick={() => setActiveView(activeView === "dealers" ? "tables" : "dealers")}>
          <Users className="w-3.5 h-3.5 mr-1" /> Danh sách Dealer
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
          <Settings className="w-3.5 h-3.5 mr-1" /> Cấu hình Swing
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
            <button key={t.id} onClick={() => { setSelectedTour(t.id); setActiveView("tables"); }}
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

      {tablesError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-500 text-xs p-3 rounded flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Lỗi tải bàn: {tablesError}</span>
          <Button size="sm" variant="ghost" className="ml-auto text-xs h-6" onClick={refetchTables}>Thử lại</Button>
        </div>
      )}
      {dealersError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-500 text-xs p-3 rounded flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Lỗi tải dealer: {dealersError}</span>
          <Button size="sm" variant="ghost" className="ml-auto text-xs h-6" onClick={refetchDealers}>Thử lại</Button>
        </div>
      )}

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
              totalDealers={allDealers?.length ?? 0}
              checkedInCount={checkedInCount}
              checkedOutDealers={checkedOutDealers ?? []}
              onSendToBreak={sendToBreak}
              onEndBreak={endBreak}
              onCheckinOpen={() => { loadCheckinDealers(); setCheckinOpen(true); }}
              onCheckoutOpen={() => setCheckoutOpen(true)}
              onBatchCheckout={handleBatchCheckoutClick}
              onReCheckin={doReCheckin}
              breakPolicies={breakPolicies ?? []}
            />
          </div>

          {/* CENTER COLUMN — 50% */}
          <div className="lg:col-span-6">
            {activeView === "dealers" ? (
              <>
                {selectedTour && (
                  <div className="text-xs text-amber-400 mb-2 flex items-center gap-2">
                    <span>Tour đang chọn: {(tours ?? []).find(t => t.id === selectedTour)?.tour_name ?? selectedTour}</span>
                    <button onClick={() => setActiveView("tables")} className="underline hover:text-amber-300">Xem bàn</button>
                  </div>
                )}
                <DealerManagementTab clubIds={filteredClubIds} clubFilter={clubFilter} />
              </>
            ) : (
                  <TableGrid
                    tables={tables ?? []}
                    tableAssignmentMap={tableAssignmentMap}
                    nextDealerMap={nextDealerMap}
                    preAssignedMap={preAssignedMap}
                    timelineByTableId={timelineByTableId}
                    swingConfigs={swingConfigs ?? []}
                    tournaments={tournaments}
                  processing={processing}
                  onAssign={openAssignModal}
                  onSendToBreak={(attId) => sendToBreak(attId)}
                  selectedTour={selectedTour}
                  onCreateTable={() => setCreateTableOpen(true)}
                  closeTableConfirmId={closeTableConfirmId}
                  onCloseTableClick={setCloseTableConfirmId}
                  onCloseTableConfirm={closeTable}
                  onCloseTableCancel={() => setCloseTableConfirmId(null)}
                  closingTable={closingTable}
                  onManualSwing={openAssignModal}
                  onForceClose={setCloseTableConfirmId}
                  isAnimating={isAnimating}
                />
            )}
          </div>

          {/* RIGHT COLUMN — 25% */}
          <div className="lg:col-span-3">
            <CommandCenter
              auditLogs={auditLogs ?? []}
              onAutoSwing={autoSwingAll}
              onMassAssign={massAssign}
              onExportShift={exportShiftReport}
              onExportPayroll={openPayroll}
              swingAllBusy={swingAllBusy}
              massAssignBusy={massAssignBusy}
              autoSwingEnabled={autoSwingEnabled}
              onToggleAutoSwing={toggleAutoSwing}
              clubFilter={clubFilter}
              clubs={clubs}
              onOpenSwingConfig={() => setSwingConfigOpen(true)}
              onOpenSpecialDates={() => setSpecialDatesOpen(true)}
              dealers={dealers ?? []}
              swingMetrics={swingMetrics ?? []}
              breakPolicies={breakPolicies ?? []}
              tables={tables ?? []}
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
                {suggestions.map((s: any, i: number) => {
                  const bd = s.score_breakdown;
                  return (
                    <div key={i} className="flex items-center justify-between p-3 bg-muted/20 border border-border rounded-none group relative">
                      <div>
                        <div className="font-semibold">{s.dealer_name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <TierBadge tier={s.tier} />
                          <span className="text-xs text-muted-foreground">{s.reason}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="relative" title={`Điểm: ${s.score}`}>
                          <span className="text-xs font-mono text-primary cursor-help border border-primary/30 px-1.5 py-0.5"
                            onMouseEnter={(e) => {
                              const el = e.currentTarget.nextElementSibling as HTMLElement;
                              if (el) el.style.display = "block";
                            }}
                            onMouseLeave={(e) => {
                              const el = e.currentTarget.nextElementSibling as HTMLElement;
                              if (el) el.style.display = "none";
                            }}>
                            {s.score}
                          </span>
                          {bd && (
                            <div className="hidden absolute bottom-full right-0 mb-1 z-50 bg-black border border-border p-2 rounded-none shadow-lg min-w-[160px]">
                              <div className="text-[10px] text-muted-foreground space-y-0.5">
                                <div className="flex justify-between"><span>Xếp hạng</span><span className={bd.tier_match >= 0 ? "text-emerald-400" : "text-red-400"}>{bd.tier_match > 0 ? `+${bd.tier_match}` : bd.tier_match}</span></div>
                                <div className="flex justify-between"><span>Công bằng</span><span className={bd.fairness >= 0 ? "text-emerald-400" : "text-red-400"}>{bd.fairness}</span></div>
                                {bd.no_back_to_back !== 0 && <div className="flex justify-between"><span>Tránh bàn cũ</span><span className="text-red-400">{bd.no_back_to_back}</span></div>}
                                {bd.skill_bonus !== 0 && <div className="flex justify-between"><span>Kỹ năng</span><span className="text-emerald-400">+{bd.skill_bonus}</span></div>}
                                {bd.heavy_worker_penalty !== 0 && <div className="flex justify-between"><span>Làm nhiều ca</span><span className="text-red-400">{bd.heavy_worker_penalty}</span></div>}
                                {bd.consecutive_high_penalty !== 0 && <div className="flex justify-between"><span>Nhiều bàn HIGH</span><span className="text-red-400">{bd.consecutive_high_penalty}</span></div>}
                                {bd.tier_back_to_back_penalty !== 0 && <div className="flex justify-between"><span>Bàn cũ (tier)</span><span className="text-red-400">{bd.tier_back_to_back_penalty}</span></div>}
                                <div className="border-t border-border pt-0.5 mt-0.5 flex justify-between font-semibold">
                                  <span>Tổng</span><span className="text-primary">{s.score}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        <Button size="sm" onClick={() => confirmAssign(s.dealer_id)} disabled={assigning}>
                          {assigning ? <Loader2 className="w-3 h-3 animate-spin" /> : "Gán"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
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

      {/* Check-in Dialog (multi-select) với 2 section: Check-in lại + Check-in mới */}
      <Dialog open={checkinOpen} onOpenChange={(o) => { setCheckinOpen(o); if (o) { loadCheckinDealers(); setCheckinDealerIds([]); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Check-in thủ công</DialogTitle></DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-2 border border-border p-2 rounded">
            {checkinDealers.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-4">Tất cả dealer đã check‑in hôm nay.</div>
            ) : (
              <>
                {/* Section: Check-in lại (đã checkout) */}
                {(() => {
                  const reCheckins = checkinDealers.filter((d: any) => d.wasCheckedOut);
                  if (!reCheckins.length) return null;
                  return (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1 sticky top-0 bg-card z-10 pb-1">
                        <UserMinus className="w-3 h-3 text-amber-400" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Check-in lại</span>
                        <Badge variant="outline" className="text-[10px] ml-auto">{reCheckins.length}</Badge>
                      </div>
                      <div className="space-y-1">
                        {reCheckins.map((d: any) => (
                          <label key={d.id}
                            className={`flex items-center gap-2 p-2 text-xs rounded cursor-pointer hover:bg-muted/20 ${checkinDealerIds.includes(d.id) ? "bg-primary/10 border border-primary/30" : "border border-transparent"}`}>
                            <Checkbox
                              checked={checkinDealerIds.includes(d.id)}
                              onCheckedChange={(chk) => {
                                if (chk) setCheckinDealerIds([...checkinDealerIds, d.id]);
                                else setCheckinDealerIds(checkinDealerIds.filter((id) => id !== d.id));
                              }}
                            />
                            <span className="font-semibold">{d.full_name}</span>
                            <Badge variant="outline" className="text-[10px]">{d.tier}</Badge>
                            <span className="text-[10px] text-amber-400">(Đã kết thúc ca)</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Section: Check-in mới */}
                {(() => {
                  const newCheckins = checkinDealers.filter((d: any) => !d.wasCheckedOut);
                  if (!newCheckins.length) return null;
                  return (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1 sticky top-0 bg-card z-10 pb-1">
                        <UserPlus className="w-3 h-3 text-emerald-400" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Check-in mới</span>
                        <Badge variant="outline" className="text-[10px] ml-auto">{newCheckins.length}</Badge>
                      </div>
                      <div className="space-y-1">
                        {newCheckins.map((d: any) => (
                          <label key={d.id}
                            className={`flex items-center gap-2 p-2 text-xs rounded cursor-pointer hover:bg-muted/20 ${checkinDealerIds.includes(d.id) ? "bg-primary/10 border border-primary/30" : "border border-transparent"}`}>
                            <Checkbox
                              checked={checkinDealerIds.includes(d.id)}
                              onCheckedChange={(chk) => {
                                if (chk) setCheckinDealerIds([...checkinDealerIds, d.id]);
                                else setCheckinDealerIds(checkinDealerIds.filter((id) => id !== d.id));
                              }}
                            />
                            <span className="font-semibold">{d.full_name}</span>
                            <Badge variant="outline" className="text-[10px]">{d.tier}</Badge>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Đã chọn: {checkinDealerIds.length}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-6 text-xs"
                onClick={() => setCheckinDealerIds(checkinDealers.map((d: any) => d.id))}>
                Chọn tất cả
              </Button>
              <Button variant="ghost" size="sm" className="h-6 text-xs"
                onClick={() => setCheckinDealerIds([])}>
                Bỏ chọn
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={doCheckin} disabled={!checkinDealerIds.length || processing === "checkin"}>
              {processing === "checkin" ? <Loader2 className="w-3 h-3 animate-spin" /> : `Check-in (${checkinDealerIds.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Checkout Confirm Dialog */}
      <Dialog open={batchCheckoutConfirmOpen} onOpenChange={setBatchCheckoutConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xác nhận Check-out hàng loạt</DialogTitle>
            <DialogDescription>
              {batchCheckoutWarnings.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-amber-500 text-sm font-medium">
                    ⚠️ Các dealer sau đang có assignment:
                  </p>
                  {batchCheckoutWarnings.map((w, i) => (
                    <p key={i} className="text-xs text-muted-foreground pl-3">{w}</p>
                  ))}
                  <p className="text-xs text-muted-foreground mt-2">
                    Checkout sẽ tự release assignment. Bàn có thể bị trống cho đến cron tick tiếp theo.
                  </p>
                </div>
              )}
              {batchCheckoutWarnings.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Xác nhận checkout {batchCheckoutPending.length} dealer?
                </p>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchCheckoutConfirmOpen(false)}>
              Huỷ
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setBatchCheckoutConfirmOpen(false);
                setBatchCheckoutWarnings([]);
                await doBatchCheckout(batchCheckoutPending);
              }}
            >
              Xác nhận Checkout {batchCheckoutPending.length} dealer
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

      {/* Pool-based Table Creation Dialog (multi-select) */}
      <Dialog open={createTableOpen} onOpenChange={(o) => { setCreateTableOpen(o); if (!o) { setPoolSearch(""); setSelectedPoolTableIds([]); setNewTableType("tournament"); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Thêm bàn từ pool</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Tìm bàn..."
              value={poolSearch}
              onChange={(e) => setPoolSearch(e.target.value)}
              className="text-xs"
            />
            <div className="max-h-48 overflow-y-auto space-y-1 border border-border p-1">
              {poolError ? (
                <div className="text-xs text-red-500 text-center py-4">Lỗi tải danh sách bàn: {poolError}. Vui lòng thử lại.</div>
              ) : poolLoading ? (
                <div className="text-xs text-muted-foreground text-center py-4">Đang tải...</div>
              ) : !poolTables || poolTables.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">Chưa có bàn nào trong pool.</div>
              ) : (
                (() => {
                  const excluded = ["11", "12", "13", "21", "A25"];
                  const filtered = poolTables
                    .filter((t) => !excluded.includes(t.table_name) && (!poolSearch || t.table_name.toLowerCase().includes(poolSearch.toLowerCase())));
                  return filtered.map((t) => {
                    const isAssigned = t.status === "active" && tableAssignmentMap[t.id];
                    const isSelectable = !isAssigned;
                    return (
                      <label key={t.id}
                        className={`flex items-center justify-between p-2 text-xs border ${isSelectable ? "cursor-pointer" : "opacity-50"} ${selectedPoolTableIds.includes(t.id) ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/20"}`}>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={selectedPoolTableIds.includes(t.id)}
                            disabled={!isSelectable}
                            onCheckedChange={(chk) => {
                              if (!isSelectable) return;
                              if (chk) setSelectedPoolTableIds([...selectedPoolTableIds, t.id]);
                              else setSelectedPoolTableIds(selectedPoolTableIds.filter((id) => id !== t.id));
                            }}
                          />
                          <span className="font-semibold">{t.table_name}</span>
                        </div>
                        {isAssigned ? (
                          <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20">Đã có dealer</Badge>
                        ) : t.status === "active" ? (
                          <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Sẵn sàng</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">Chưa active</Badge>
                        )}
                      </label>
                    );
                  });
                })()
              )}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Đã chọn: {selectedPoolTableIds.length} bàn</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-6 text-xs"
                  onClick={() => {
                    const excluded = ["11", "12", "13", "21", "A25"];
                    const selectable = (poolTables ?? [])
                      .filter((t) => !excluded.includes(t.table_name) && (!poolSearch || t.table_name.toLowerCase().includes(poolSearch.toLowerCase())))
                      .filter((t) => !(t.status === "active" && tableAssignmentMap[t.id]));
                    setSelectedPoolTableIds(selectable.map((t: any) => t.id));
                  }}>
                  Chọn tất cả
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs"
                  onClick={() => setSelectedPoolTableIds([])}>
                  Bỏ chọn
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Loại bàn</Label>
              <Select value={newTableType} onValueChange={setNewTableType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tournament">Tournament</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTableOpen(false)}>Huỷ</Button>
            <Button disabled={!selectedPoolTableIds.length || processing === "create_table"}
              onClick={async () => {
                setProcessing("create_table");
                let success = 0, fail = 0;
                for (const tableId of selectedPoolTableIds) {
                  // Clean up stale dealer assignments (if table was closed without releasing dealer)
                  const { data: staleAssignments } = await supabase
                    .from("dealer_assignments")
                    .select("id, attendance_id")
                    .eq("table_id", tableId)
                    .in("status", ["assigned", "on_break"]);
                  for (const sa of staleAssignments ?? []) {
                    await supabase.from("dealer_assignments").update({
                      released_at: new Date().toISOString(), status: "completed",
                    }).eq("id", sa.id);
                    await supabase.from("dealer_attendance").update({
                      current_state: "available",
                    }).eq("id", sa.attendance_id);
                  }
                  const { error } = await supabase.from("game_tables").update({
                    shift_id: selectedTour ?? null,
                    status: "active",
                    table_type: newTableType,
                  }).eq("id", tableId);
                  if (error) { fail++; } else { success++; }
                }
                setProcessing(null);
                if (fail > 0) toast.warning(`Thêm bàn: ${success} thành công, ${fail} thất bại`);
                else toast.success(`Đã thêm ${success} bàn vào tour`);
                setCreateTableOpen(false);
                setPoolSearch("");
                setSelectedPoolTableIds([]);
                setNewTableType("tournament");
                refetchTables();
                refetchAvailableTables();
                refetchPoolTables();
                if (success > 0) {
                  const assigned = await massAssign();
                  if (assigned > 0) toast.success(`Đã tự động gán dealer cho ${assigned} bàn`);
                }
              }}>
              {processing === "create_table" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Xác nhận"}
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
      <Dialog open={payrollOpen} onOpenChange={(o) => { if (!o) { setPayrollOpen(false); setPayrollData(null); setPayrollEdits({}); setPayrollEditDealer(null); } }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Bảng lương — {payrollClubSlug}</DialogTitle>
            <DialogDescription>
              {payrollDateBounds.from} → {payrollDateBounds.to} · {payrollData?.length ?? 0} dealer
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 flex-wrap">
            {(["today", "month", "custom"] as const).map((preset) => (
              <button
                key={preset}
                onClick={() => setPayrollDatePreset(preset)}
                className={`px-3 py-1 text-xs rounded-full transition-colors ${
                  payrollDatePreset === preset
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700"
                }`}
              >
                {preset === "today" ? "Hôm nay" : preset === "month" ? "Tháng này" : "Tuỳ chỉnh"}
              </button>
            ))}
            {payrollDatePreset === "custom" && (
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="text-xs h-8">
                      {payrollFromDate ? format(payrollFromDate, "dd/MM/yyyy") : "Từ ngày"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={payrollFromDate}
                      onSelect={(d) => d && setPayrollFromDate(d)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <span className="text-xs text-muted-foreground">→</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="text-xs h-8">
                      {payrollToDate ? format(payrollToDate, "dd/MM/yyyy") : "Đến ngày"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={payrollToDate}
                      onSelect={(d) => d && setPayrollToDate(d)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Button size="sm" variant="outline" className="text-xs h-8" onClick={reloadPayroll} disabled={payrollLoading}>
                  <RefreshCw className={`w-3 h-3 mr-1 ${payrollLoading ? "animate-spin" : ""}`} />
                  Tải
                </Button>
              </div>
            )}
            {payrollDatePreset !== "custom" && (
              <Button size="sm" variant="outline" className="text-xs h-8 ml-auto" onClick={reloadPayroll} disabled={payrollLoading}>
                <RefreshCw className={`w-3 h-3 mr-1 ${payrollLoading ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dealer</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Hạng</TableHead>
                  <TableHead className="text-right">Tổng giờ</TableHead>
                  <TableHead className="text-right">OT phút</TableHead>
                  <TableHead className="text-right">Swing</TableHead>
                  <TableHead className="text-right">Giờ (VND)</TableHead>
                  <TableHead className="text-right">Lương CB</TableHead>
                  <TableHead className="text-right">Lương OT</TableHead>
                  <TableHead className="text-right">Tổng lương</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payrollLoading ? (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></TableCell></TableRow>
                ) : (payrollData ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">Không có dữ liệu</TableCell></TableRow>
                ) : (
                  <>
                    {(payrollData ?? []).map((r: any, i: number) => {
                      const edits = payrollEdits[r.dealer_id] ?? {};
                      const isEditing = payrollEditDealer === r.dealer_id;
                      const displayRow = recalcPay(r, edits);
                      return (
                      <TableRow key={r.dealer_id ?? i}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1">
                            {r.full_name}
                            {!isEditing && (
                              <button className="text-[10px] text-muted-foreground hover:text-primary ml-1" onClick={() => setPayrollEditDealer(r.dealer_id)} title="Điều chỉnh">
                                ✏️
                              </button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.employment_type === "part_time" ? "outline" : "default"} className="text-[10px]">
                            {r.employment_type === "part_time" ? "PT" : "FT"}
                          </Badge>
                        </TableCell>
                        <TableCell>{r.tier}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.1"
                              className="w-20 bg-zinc-900 border border-zinc-700 text-white text-xs text-right px-1 py-0.5 rounded"
                              value={edits.adjustedHours ?? r.total_hours}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                setPayrollEdits(prev => ({ ...prev, [r.dealer_id]: { ...prev[r.dealer_id], adjustedHours: isNaN(v) ? undefined : v } }));
                              }}
                            />
                          ) : (
                            Number(displayRow.total_hours).toFixed(1)
                          )}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-xs ${r.overtime_minutes > 30 ? "text-red-400 font-semibold" : ""}`}>
                          {r.overtime_minutes > 0 ? (() => { const h = Math.floor(r.overtime_minutes / 60); const m = r.overtime_minutes % 60; return h > 0 ? `${h}h ${m}ph` : `${m}ph`; })() : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.total_swings}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {isEditing ? (
                            <input
                              type="number"
                              step="1000"
                              className="w-24 bg-zinc-900 border border-zinc-700 text-white text-xs text-right px-1 py-0.5 rounded"
                              value={edits.adjustedRate ?? r.hourly_rate_vnd}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                setPayrollEdits(prev => ({ ...prev, [r.dealer_id]: { ...prev[r.dealer_id], adjustedRate: isNaN(v) ? undefined : v } }));
                              }}
                            />
                          ) : (
                            Number(displayRow.hourly_rate_vnd).toLocaleString("vi-VN")
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{Number(displayRow.base_pay).toLocaleString("vi-VN")}</TableCell>
                        <TableCell className={`text-right font-mono text-xs ${r.overtime_minutes > 30 ? "text-red-400 font-semibold" : ""}`}>
                          {displayRow.overtime_pay > 0 ? Number(displayRow.overtime_pay).toLocaleString("vi-VN") : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold text-emerald-400">{Number(displayRow.total_pay).toLocaleString("vi-VN")}</TableCell>
                      </TableRow>
                      );
                    })}
                    <TableRow className="border-t-2 border-emerald-600/40 bg-emerald-600/5">
                      <TableCell className="font-bold text-emerald-400">TỔNG</TableCell>
                      <TableCell colSpan={2} />
                      <TableCell className="text-right font-mono text-xs font-semibold">
                        {(payrollData ?? []).reduce((s, r: any) => { const e = payrollEdits[r.dealer_id] ?? {}; return s + (e.adjustedHours ?? r.total_hours); }, 0).toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-amber-400">
                        {(() => { const total = payrollData?.reduce((s: number, r: any) => s + (r.overtime_minutes ?? 0), 0) ?? 0; const h = Math.floor(total / 60); const m = total % 60; return total > 0 ? (h > 0 ? `${h}h ${m}ph` : `${m}ph`) : "—"; })()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">
                        {payrollData?.reduce((s, r: any) => s + (r.total_swings ?? 0), 0)}
                      </TableCell>
                      <TableCell />
                      <TableCell className="text-right font-mono text-xs font-semibold">
                        {Number((payrollData ?? []).reduce((s: number, r: any) => { const e = payrollEdits[r.dealer_id] ?? {}; return s + Number(recalcPay(r, e).base_pay); }, 0)).toLocaleString("vi-VN")}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold text-red-400">
                        {(() => { const total = (payrollData ?? []).reduce((s: number, r: any) => { const e = payrollEdits[r.dealer_id] ?? {}; return s + Number(recalcPay(r, e).overtime_pay); }, 0); return total > 0 ? Number(total).toLocaleString("vi-VN") : "—"; })()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold text-emerald-400">
                        {Number((payrollData ?? []).reduce((s: number, r: any) => { const e = payrollEdits[r.dealer_id] ?? {}; return s + Number(recalcPay(r, e).total_pay); }, 0)).toLocaleString("vi-VN")}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPayrollOpen(false); setPayrollData(null); setPayrollEdits({}); setPayrollEditDealer(null); }}>Đóng</Button>
            {payrollEditDealer && (
              <Button variant="outline" onClick={() => setPayrollEditDealer(null)}>
                ✅ Xong điều chỉnh
              </Button>
            )}
            {Object.keys(payrollEdits).length > 0 && !payrollEditDealer && (
              <Button variant="outline" onClick={() => { setPayrollEdits({}); }}>
                ↺ Reset
              </Button>
            )}
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

      {/* Special Dates Dialog (Bug 6) */}
      <Dialog open={specialDatesOpen} onOpenChange={setSpecialDatesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Ngày đặc biệt</DialogTitle></DialogHeader>

          {/* Add form */}
          <div className="space-y-3 pb-4 border-b border-border">
            <p className="text-xs text-muted-foreground font-medium">Thêm ngày mới</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Ngày</label>
                <Input
                  type="date"
                  value={sdForm.date}
                  onChange={(e) => setSdForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Tên ngày lễ</label>
                <Input
                  placeholder="VD: Tết Nguyên Đán"
                  value={sdForm.label}
                  onChange={(e) => setSdForm(f => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Hệ số (×)</label>
                <Input
                  type="number"
                  step="0.1"
                  min="1"
                  max="10"
                  placeholder="1.5"
                  value={sdForm.multiplier}
                  onChange={(e) => setSdForm(f => ({ ...f, multiplier: e.target.value }))}
                />
              </div>
            </div>
            <Button size="sm" onClick={handleAddSpecialDate} disabled={sdSaving || !sdForm.date}>
              {sdSaving ? "Đang lưu..." : "+ Thêm"}
            </Button>
          </div>

          {/* List */}
          <div className="max-h-[40vh] overflow-y-auto space-y-2 mt-3">
            {(!specialDates || specialDates.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">Chưa có ngày đặc biệt nào.</p>
            )}
            {specialDates?.map((sd) => (
              <div key={sd.id} className="flex items-center justify-between p-2 bg-muted/10 border border-border rounded">
                <div>
                  <div className="text-xs font-semibold">
                    {new Date(sd.date).toLocaleDateString("vi-VN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                  </div>
                  {sd.label && <div className="text-[10px] text-muted-foreground">{sd.label}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">x{sd.multiplier}</Badge>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => handleDeleteSpecialDate(sd.id, sd.label ?? sd.date)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSpecialDatesOpen(false)}>Đóng</Button>
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

function FatigueDot({ attendance }: { attendance: DealerAttendance }) {
  const worked = attendance.worked_minutes_since_last_break ?? 0;
  const priority = attendance.priority_break_flag ?? false;
  let color: string;
  if (priority || worked >= 90) color = "bg-red-500";
  else if (worked >= 60) color = "bg-amber-500";
  else color = "bg-emerald-500";
  return <div className={`w-2 h-2 rounded-full ${color} flex-shrink-0`} title={`Đã làm ${worked}p${priority ? " (ưu tiên nghỉ)" : ""}`} />;
}

function PriorityBreakIndicator({
  priorityBreakFlag,
  workedMinutesSinceLastBreak,
  maxWorkMinutes = 105,
}: {
  priorityBreakFlag: boolean;
  workedMinutesSinceLastBreak: number;
  maxWorkMinutes?: number;
}) {
  const worked = workedMinutesSinceLastBreak ?? 0;
  if (!priorityBreakFlag && worked < 75) return null;

  const remaining = Math.max(0, maxWorkMinutes - worked);
  const isMandatory = worked >= maxWorkMinutes;
  const isWarning = worked >= 75 && !isMandatory;

  if (isMandatory || priorityBreakFlag) {
    return (
      <span className="priority-break-badge--mandatory" title={`Làm ${worked} phút — bắt buộc nghỉ`}>
        🔴 Nghỉ ngay
      </span>
    );
  }

  if (isWarning) {
    return (
      <span className="priority-break-badge--warning" title={`Làm ${worked}/${maxWorkMinutes} phút — còn ${remaining} phút`}>
        ⚠️ {remaining}ph
      </span>
    );
  }

  return null;
}

function RosterPanel({
  dealers, assignments, swingConfigs, processing, totalDealers, checkedInCount,
  checkedOutDealers, onSendToBreak, onEndBreak, onCheckinOpen, onCheckoutOpen,
  onBatchCheckout, onReCheckin, breakPolicies,
}: {
  dealers: DealerAttendance[];
  assignments: DealerAssignment[];
  swingConfigs: SwingConfig[];
  processing: string | null;
  totalDealers: number;
  checkedInCount?: number;
  checkedOutDealers: DealerAttendance[];
  onSendToBreak: (attendanceId: string) => void;
  onEndBreak: (attendanceId: string) => void;
  onCheckinOpen: () => void;
  onCheckoutOpen: () => void;
  onBatchCheckout: (ids: string[]) => void;
  onReCheckin: (dealerId: string) => void;
  breakPolicies: ShiftBreakPolicy[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllInSection = (ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const allDealerIds = useMemo(() => dealers.map((d) => d.id), [dealers]);
  const allSelected = allDealerIds.length > 0 && allDealerIds.every((id) => selectedIds.has(id));
  const dealerStatuses = useMemo(() => {
    const map: Record<string, { status: string; tableName?: string; checkInTime: string; timerStart: string }> = {};
    for (const d of dealers) {
      const a = assignments.find((a) => a.attendance_id === d.id);
      const checkInTime = d.check_in_time ?? new Date().toISOString();
      if (a?.status === "assigned") {
        map[d.id] = { status: "Đang bàn", tableName: (a as any).game_tables?.table_name, checkInTime, timerStart: a.assigned_at };
      } else if (a?.status === "on_break") {
        map[d.id] = { status: "Đang nghỉ", tableName: undefined, checkInTime, timerStart: a.released_at ?? checkInTime };
      } else if (d.current_state === "pre_assigned") {
        map[d.id] = { status: "Đang chờ", tableName: undefined, checkInTime, timerStart: checkInTime };
      } else if (d.current_state === "assigned") {
        map[d.id] = { status: "Đang bàn", tableName: undefined, checkInTime, timerStart: checkInTime };
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
    { key: "Đang chờ", icon: Clock, color: "text-purple-400" },
  ] as const;

  return (
    <Card className="p-3 h-full">
      <div className="flex items-center gap-2 mb-1">
        {dealers.length > 0 && (
          <input type="checkbox" className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
            checked={allSelected}
            onChange={() => toggleAllInSection(allDealerIds)} />
        )}
        <Users className="w-4 h-4 text-primary" />
        <span className="font-display text-sm tracking-wider">ĐỘI HÌNH CHIẾN BINH</span>
      </div>
      <div className="text-[11px] text-muted-foreground mb-3 flex items-center gap-1.5">
        <span className="text-emerald-400 font-semibold">{checkedInCount ?? dealers.length}</span>
        <span>/</span>
        <span>{totalDealers}</span>
        <span className="ml-1">đang hoạt động</span>
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
                  <input type="checkbox" className="w-3 h-3 accent-emerald-500 cursor-pointer"
                    checked={group.length > 0 && group.every((d) => selectedIds.has(d.id))}
                    onChange={() => toggleAllInSection(group.map((d) => d.id))} />
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
                        <input type="checkbox" className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                          checked={selectedIds.has(d.id)}
                          onChange={() => toggleId(d.id)} />
                        <div className="relative">
                          <div className="w-8 h-8 rounded-none bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                            {dd?.full_name?.charAt(0) ?? "?"}
                          </div>
                          {sec.key === "Sẵn sàng" && <div className="absolute -top-1 -right-1"><FatigueDot attendance={d} /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{dd?.full_name ?? "—"}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <TierBadge tier={dd?.tier} />
                            <StatusPill status={sec.key} />
                            <PriorityBreakIndicator priorityBreakFlag={d.priority_break_flag} workedMinutesSinceLastBreak={d.worked_minutes_since_last_break} />
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

        {/* Đã check-out section */}
        {checkedOutDealers.length > 0 && (
          <div className="pt-2 border-t border-border/40">
            <div className="flex items-center gap-1.5 mb-2">
              <UserMinus className="w-3 h-3 text-muted-foreground" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Đã check-out</span>
              <Badge variant="outline" className="text-[10px] ml-auto">{checkedOutDealers.length}</Badge>
            </div>
            <div className="space-y-1.5 opacity-60 hover:opacity-100 transition-opacity">
              {checkedOutDealers.map((d) => {
                const dd = d.dealers;
                return (
                  <div key={d.id} className="flex items-center gap-2 p-2 bg-muted/10 border border-border rounded-none">
                    <div className="w-8 h-8 rounded-none bg-gray-500/20 flex items-center justify-center text-xs font-bold text-gray-400">
                      {dd?.full_name?.charAt(0) ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate text-muted-foreground">{dd?.full_name ?? "—"}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <TierBadge tier={dd?.tier} />
                        <span className="text-[10px] text-muted-foreground">
                          {d.check_out_time ? format(new Date(d.check_out_time), "HH:mm") : "?"}
                        </span>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-[11px]"
                      onClick={() => onReCheckin(d.dealer_id)} disabled={processing !== null}>
                      Check-in lại
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-3 pt-3 border-t border-border flex-wrap">
        <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onCheckinOpen}>
          <UserPlus className="w-3 h-3 mr-1" /> Check-in
        </Button>
        <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onCheckoutOpen}>
          <UserMinus className="w-3 h-3 mr-1" /> Check-out
        </Button>
        {selectedIds.size > 0 && (
          <Button size="sm" variant="outline" className="w-full text-xs text-red-400 border-red-400/30 hover:bg-red-500/10 mt-1"
            onClick={() => { onBatchCheckout([...selectedIds]); setSelectedIds(new Set()); }}>
            <UserMinus className="w-3 h-3 mr-1" /> Checkout hàng loạt ({selectedIds.size})
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ==============================================================
   TABLE GRID — Center Column
   ============================================================== */
function TableGrid({
  tables, tableAssignmentMap, nextDealerMap, preAssignedMap, timelineByTableId, swingConfigs, tournaments, processing, onAssign, onSendToBreak, selectedTour, onCreateTable,
  closeTableConfirmId, onCloseTableClick, onCloseTableConfirm, onCloseTableCancel, closingTable,
  onManualSwing, onForceClose, isAnimating,
}: {
  tables: any[];
  tableAssignmentMap: Record<string, DealerAssignment | null>;
  nextDealerMap: Record<string, NextDealerPrediction> | null;
  preAssignedMap: Record<string, PreAssignedInfo | null>;
  timelineByTableId: Record<string, { minutesLeft: number; showNextDealerSoon: boolean; isOverdue: boolean }>;
  swingConfigs: SwingConfig[];
  tournaments: TournamentWithTables[] | undefined;
  processing: string | null;
  onAssign: (tableId: string) => void;
  onSendToBreak: (attendanceId: string) => void;
  selectedTour: string | null;
  onCreateTable: () => void;
  closeTableConfirmId: string | null;
  onCloseTableClick: (tableId: string) => void;
  onCloseTableConfirm: () => void;
  onCloseTableCancel: () => void;
  closingTable: boolean;
  onManualSwing?: (tableId: string) => void;
  onForceClose?: (tableId: string) => void;
  isAnimating?: (tableId: string) => boolean;
}) {
  // Filter tables based on selected tour using shift_id column
  const filteredTables = useMemo(() => {
    if (!selectedTour) return tables;
    return tables.filter((t) => t.shift_id === selectedTour);
  }, [tables, selectedTour]);

  // Safe handler when a swing timer expires: guards against cross-tab duplicate
  // and re-checks swing_processed_at before calling sendToBreak
  const onTimerExpired = useCallback(async (attendanceId: string, assignmentId: string) => {
    const lockKey = `swing_expired_${assignmentId}`;
    try {
      if (localStorage.getItem(lockKey)) return;
      localStorage.setItem(lockKey, '1');
    } catch { /* localStorage unavailable */ }

    try {
      const { data } = await supabase
        .from('dealer_assignments')
        .select('swing_processed_at')
        .eq('id', assignmentId)
        .maybeSingle();

      if (data?.swing_processed_at) return; // backend already handled it
      onSendToBreak(attendanceId);
    } catch {
      onSendToBreak(attendanceId);
    }
  }, [onSendToBreak]);

  return (
    <Card className="p-3 h-full">
      <div className="flex items-center gap-2 mb-3">
        <Table2 className="w-4 h-4 text-primary" />
        <span className="font-display text-sm tracking-wider">BẢN ĐỒ CHIẾN TRƯỜNG</span>
        <Badge variant="outline" className="ml-auto text-xs">{filteredTables.length} bàn</Badge>
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={onCreateTable}>
          + Thêm bàn
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
            // Resolve config: tournament → club default
            const tableTournament = tournaments?.find((tr) =>
              tr.tournament_tables.some((tt) => tt.table_id === t.id)
            );
            const warnAt = tableTournament?.warn_at_minutes ?? swingConfigs?.find((c) => c.table_type === t.table_type)?.warn_at_minutes ?? 5;
            const critAt = tableTournament?.crit_at_minutes ?? swingConfigs?.find((c) => c.table_type === t.table_type)?.crit_at_minutes ?? 1;

            const dealer = a ? (a as any).dealer_attendance?.dealers : null;

            return (
              <div key={t.id} className={`p-3 bg-muted/10 border border-border rounded-none animate-in fade-in slide-in-from-bottom-1 duration-300 ${isAnimating?.(t.id) ? "table-card--swinging" : ""}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {t.table_name}
                    {onManualSwing && onForceClose && (
                      <TableCardKebab
                        tableId={t.id}
                        tableName={t.table_name}
                        hasActiveAssign={!!a}
                        onManualSwing={() => onManualSwing(t.id)}
                        onForceClose={() => onForceClose(t.id)}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <TableTypeBadge type={t.table_type} />
                    {closeTableConfirmId === t.id ? (
                      <div className="flex items-center gap-1">
                        <button className="text-destructive text-[10px] hover:underline" onClick={onCloseTableConfirm} disabled={closingTable}>
                          Xác nhận
                        </button>
                        <button className="text-muted-foreground text-[10px] hover:underline" onClick={onCloseTableCancel}>
                          Huỷ
                        </button>
                      </div>
                    ) : (
                      <button className="text-muted-foreground hover:text-destructive text-xs ml-1" title="Đóng bàn"
                        onClick={() => onCloseTableClick(t.id)}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
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
                    <div className="text-xs flex items-center gap-1">
                      {preAssignedMap[t.id] ? (
                        <span className="text-primary flex items-center gap-1"><span>⬆</span> {preAssignedMap[t.id]!.full_name}</span>
                      ) : (
                        <><AlertTriangle className="w-3 h-3 text-warning" /><span className="text-warning"> Trống</span></>
                      )}
                    </div>
                  )}
                </div>

                {/* Countdown timer + upcoming dealer (next dealer prediction) */}
                <div className="flex items-center justify-between">
                  {a && (
                    <TableTimerDisplay
                      overtimeStartedAt={a.overtime_started_at}
                      swingDueAt={a.swing_due_at}
                    />
                  )}
                  {nextDealerMap?.[t.id] && nextDealerMap[t.id]!.nextDealerName && (
                    <div className="ml-auto">
                      {nextDealerMap[t.id]!.confidence === "confirmed" ? (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-500 border border-emerald-500/40 px-1 py-0.5 font-bold">
                          ✅ CHỐT
                        </span>
                      ) : (
                        <span className="text-[10px] bg-amber-500/20 text-amber-500 border border-amber-500/40 px-1 py-0.5 font-bold">
                          🔮 PV
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Next Dealer Preview — shows at ≤5 min */}
                {(() => {
                  const tl = timelineByTableId[t.id];
                  if (!tl?.showNextDealerSoon) return null;
                  const pred = nextDealerMap?.[t.id];
                  if (!pred?.nextDealerName) return null;
                  return (
                    <NextDealerPreview
                      minutesLeft={tl.minutesLeft}
                      dealerName={pred.nextDealerName}
                      telegramUsername={(pred as any).telegram_username ?? null}
                      confidence={pred.confidence as "confirmed" | "predicted"}
                    />
                  );
                })()}

                {/* Overdue badge */}
                {(() => {
                  const tl = timelineByTableId[t.id];
                  if (!tl?.isOverdue) return null;
                  return (
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-red-500 bg-red-500/10 border border-red-500/30 px-2 py-0.5">
                      <span className="animate-pulse">⏰</span> OVERDUE
                    </span>
                  );
                })()}

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
   AUTO-SCROLL AUDIT LOG HOOK
   ============================================================== */
function useAutoScrollLog(logs: unknown[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [unread, setUnread] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnread(0);
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsPaused(distFromBottom > 50);
  }, []);

  useEffect(() => {
    if (isPaused) {
      setUnread((n) => n + 1);
    } else {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs.length]);

  return { containerRef, unread, isPaused, scrollToBottom, handleScroll };
}

/* ==============================================================
   COMMAND CENTER — Right Column
   ============================================================== */
function CommandCenter({
  auditLogs, onAutoSwing, onMassAssign,
  onExportShift, onExportPayroll, swingAllBusy, massAssignBusy,
  autoSwingEnabled, onToggleAutoSwing,
  clubFilter, clubs, onOpenSwingConfig,
  onOpenSpecialDates, dealers, swingMetrics, breakPolicies, tables,
}: {
  auditLogs: any[];
  onAutoSwing: () => void;
  onMassAssign: () => void;
  onExportShift: () => void;
  onExportPayroll: () => void;
  swingAllBusy: boolean;
  massAssignBusy: boolean;
  autoSwingEnabled: boolean;
  onToggleAutoSwing: () => void;
  clubFilter: string | null;
  clubs: ClubRow[];
  onOpenSwingConfig: () => void;
  onOpenSpecialDates: () => void;
  dealers: DealerAttendance[];
  swingMetrics: SwingMetrics[];
  breakPolicies: ShiftBreakPolicy[];
  tables: any[];
}) {
  const clubName = useMemo(() => Object.fromEntries(clubs.map((c) => [c.id, c.name])), [clubs]);

  // ── Internal dialogs ────────────────────────────────────────────
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [stopSaving, setStopSaving] = useState(false);

  const testTelegram = async () => {
    if (!clubFilter) { toast.error("Vui lòng chọn CLB trước"); return; }
    const msg = `🧪 Test từ VBacker Swing Manager\nCLB: ${clubName[clubFilter] ?? clubFilter}\nThời gian: ${new Date().toLocaleString("vi-VN")}`;
    const { error } = await supabase.functions.invoke("telegram-swing-notifier", {
      body: { chat_id: "__club__", message: msg, club_id: clubFilter },
    });
    if (error) toast.error(error.message);
    else toast.success("Đã gửi test Telegram");
  };

  const handleStopSwing = async () => {
    const cid = clubFilter;
    if (!cid) return;
    setStopSaving(true);
    const { error } = await supabase
      .from("club_settings")
      .upsert({ club_id: cid, auto_swing_enabled: false }, { onConflict: "club_id" });
    setStopSaving(false);
    setStopConfirmOpen(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Đã tắt Auto-Swing");
    onToggleAutoSwing(); // sync parent state
  };

  const totMetrics = swingMetrics.reduce((s, m) => s + m.total_swings, 0);
  const okMetrics = swingMetrics.reduce((s, m) => s + m.successful_swings, 0);
  const failMetrics = swingMetrics.reduce((s, m) => s + m.failed_swings, 0);
  const successRate = totMetrics > 0 ? ((okMetrics / totMetrics) * 100).toFixed(0) : "—";

  return (
    <>
      <Card className="p-3 h-full flex flex-col gap-3">
        {/* HEADER */}
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <span className="font-display text-sm tracking-wider">ĐÀI CHỈ HUY</span>
        </div>

        {/* ─────────────── GROUP 1: VẬN HÀNH NỀN ─────────────── */}
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Vận hành nền
          </div>
          <div className="flex items-center justify-between px-3 py-2 border border-border rounded-sm">
            <span className="text-xs font-semibold">Auto-Swing</span>
            <Switch checked={autoSwingEnabled} onCheckedChange={onToggleAutoSwing} />
          </div>
          <div className="grid grid-cols-2 gap-1 mt-1">
            <Button size="sm" variant="outline" className="text-xs h-8" onClick={onOpenSwingConfig}>
              <Settings className="w-3 h-3 mr-1" /> Cấu hình
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-8" onClick={onOpenSpecialDates}>
              <CalendarIcon className="w-3 h-3 mr-1" /> Ngày ĐB
            </Button>
          </div>
        </div>

        <hr className="border-border/60" />

        {/* ─────────────── GROUP 2: THAO TÁC THƯỜNG XUYÊN ─────────────── */}
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Thao tác thường xuyên
          </div>
          <div className="space-y-1">
            <Button size="sm" className="w-full justify-start text-xs" onClick={onAutoSwing} disabled={swingAllBusy}>
              {swingAllBusy ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-2" />}
              Auto-Swing All
            </Button>
            <Button size="sm" variant="outline" className="w-full justify-start text-xs" onClick={onMassAssign} disabled={massAssignBusy}>
              {massAssignBusy ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <LayoutDashboard className="w-3 h-3 mr-2" />}
              Mass Assign
            </Button>
          </div>
        </div>

        <hr className="border-border/60" />

        {/* ─────────────── GROUP 3: ĐẦU CA & CUỐI CA ─────────────── */}
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Đầu ca & Cuối ca
          </div>
          <div className="space-y-1">
            <Button size="sm" variant="outline" className="w-full justify-start text-xs" onClick={testTelegram}>
              <Send className="w-3 h-3 mr-2" /> Gửi Telegram test
            </Button>
            <Button size="sm" variant="outline" className="w-full justify-start text-xs" onClick={onExportShift}>
              <FileSpreadsheet className="w-3 h-3 mr-2" /> Xuất báo cáo ca
            </Button>
            <Button size="sm" variant="outline" className="w-full justify-start text-xs" onClick={onExportPayroll}>
              <DollarSign className="w-3 h-3 mr-2" /> Xuất bảng lương
            </Button>
          </div>
        </div>

        <hr className="border-border/60" />

        {/* ─────────────── GROUP 4: KHẨN CẤP ─────────────── */}
        <div>
          <div className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-1.5">
            Khẩn cấp
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start text-xs border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            onClick={() => setStopConfirmOpen(true)}
          >
            <AlertTriangle className="w-3 h-3 mr-2" />
            Dừng toàn bộ Swing
          </Button>
        </div>

        {/* ─────────────── BREAK BALANCE WIDGET ─────────────── */}
        <div className="p-3 bg-muted/10 border border-border rounded-sm">
          <div className="text-[11px] font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            CÂN BẰNG BREAK
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Đang hoạt động</span>
              <span className="font-semibold font-mono">{dealers.length}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-amber-500">Sắp đến giờ nghỉ</span>
              <span className="font-semibold font-mono text-amber-500">
                {dealers.filter((d) => {
                  const w = d.worked_minutes_since_last_break ?? 0;
                  return w >= 60 && w < 90 && !d.priority_break_flag;
                }).length}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-red-500">Cần nghỉ ngay</span>
              <span className="font-semibold font-mono text-red-500">
                {dealers.filter((d) => {
                  const w = d.worked_minutes_since_last_break ?? 0;
                  return w >= 90 || d.priority_break_flag;
                }).length}
              </span>
            </div>
            <div className="border-t border-border pt-1.5 mt-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Swing hôm nay</span>
                <span className="font-mono">{totMetrics}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Tỉ lệ thành công</span>
                <span className="font-mono">{successRate}%</span>
              </div>
              {failMetrics > 0 && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-red-400">Thất bại</span>
                  <span className="font-mono text-red-400">{failMetrics}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─────────────── AUDIT LOG ─────────────── */}
        <AuditLogSection logs={auditLogs} />
      </Card>

      {/* ── Stop Swing Confirmation ── */}
      <AlertDialog open={stopConfirmOpen} onOpenChange={setStopConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dừng toàn bộ Swing</AlertDialogTitle>
            <AlertDialogDescription>
              Thao tác này sẽ tắt Auto-Swing ngay lập tức và dừng cron job xoay dealer.
              Bạn có chắc chắn muốn dừng?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-500 text-white"
              onClick={handleStopSwing}
              disabled={stopSaving}
            >
              {stopSaving ? "Đang dừng..." : "Dừng"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}

/* ==============================================================
   TIMER CELL — self-updating countdown (1s interval, no parent re-render)
   Uses swing_due_at directly when available for accurate countdown.
   ============================================================== */
function TimerCell({ swingDueAt, warnAt, critAt, attendanceId, assignmentId, onExpired }: {
  swingDueAt: string;
  warnAt: number;
  critAt: number;
  /** Optional: fires once when timer hits 0, with cross-tab guard built in via hasFiredRef */
  attendanceId?: string;
  assignmentId?: string;
  onExpired?: (attendanceId: string, assignmentId: string) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const hasFiredRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeLeftMs = new Date(swingDueAt).getTime() - now;
  const timeLeft = Math.max(0, timeLeftMs / (1000 * 60));
  const m = Math.floor(timeLeft);
  const s = Math.floor((timeLeft - m) * 60);

  // Fire onExpired once when timer reaches 0 (timeLeft <= 0 handles background throttle)
  useEffect(() => {
    if (timeLeft <= 0 && !hasFiredRef.current && attendanceId && assignmentId && onExpired) {
      hasFiredRef.current = true;
      onExpired(attendanceId, assignmentId);
    }
  }, [timeLeft, attendanceId, assignmentId, onExpired]);

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
   NEXT DEALER BADGE
   ============================================================== */
/* ==============================================================
   TABLE TYPE BADGE
   ============================================================== */
function TableTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    tournament: "Tournament",
  };
  const colors: Record<string, string> = {
    tournament: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 border font-semibold ${colors[type] ?? "bg-primary/10 text-primary border-primary/30"} rounded-none`}>
      {labels[type] ?? type}
    </span>
  );
}

/* ==============================================================
   SWING CONFIG DIALOG
   ============================================================== */
// ─── Hook: live effective duration from v_club_swing_status ────────────────
function useEffectiveDuration(clubId: string, autoAdjustEnabled: boolean) {
  const [effectiveDuration, setEffectiveDuration] = useState<number | null>(null);
  const [poolRatio, setPoolRatio] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!autoAdjustEnabled || !clubId) {
      setEffectiveDuration(null);
      setPoolRatio(null);
      return;
    }
    let cancelled = false;

    async function fetch() {
      setLoading(true);
      const { data } = await supabase
        .from("v_club_swing_status")
        .select("effective_duration_minutes, available_dealers, pre_assigned_weighted, active_tables")
        .eq("club_id", clubId)
        .eq("table_type", "tournament")
        .maybeSingle();

      if (!cancelled && data) {
        setEffectiveDuration(data.effective_duration_minutes);
        const pool = (data.available_dealers ?? 0) + (data.pre_assigned_weighted ?? 0);
        const tables = data.active_tables ?? 0;
        setPoolRatio(tables > 0 ? pool / tables : null);
      }
      if (!cancelled) setLoading(false);
    }

    fetch();
    const interval = setInterval(fetch, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [clubId, autoAdjustEnabled]);

  return { effectiveDuration, poolRatio, loading };
}

// ─── Auto-adjust section inside SwingConfigDialog ─────────────────────────
function AutoAdjustSection({
  clubId, autoAdjust, baseDuration, targetRatio, minDuration, maxDuration,
  onChange,
}: {
  clubId: string;
  autoAdjust: boolean;
  baseDuration: number;
  targetRatio: number;
  minDuration: number;
  maxDuration: number;
  onChange: (patch: Record<string, number>) => void;
}) {
  const { effectiveDuration, poolRatio, loading } = useEffectiveDuration(clubId, autoAdjust);
  const [suggestResult, setSuggestResult] = useState<any>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const staffingLabel =
    poolRatio == null ? null
    : poolRatio < 0.8 ? { text: "Thiếu dealer", color: "text-red-500" }
    : poolRatio < 1.1 ? { text: "Bình thường",  color: "text-yellow-500" }
    :                    { text: "Đủ dealer",     color: "text-green-500" };

  const range = maxDuration - minDuration;
  const basePct = range > 0 ? ((baseDuration - minDuration) / range) * 100 : 50;
  const effectivePct = effectiveDuration != null && range > 0
    ? ((effectiveDuration - minDuration) / range) * 100 : null;

  const suggest = async () => {
    setSuggestLoading(true);
    setSuggestResult(null);
    try {
      const { data, error } = await supabase.rpc("suggest_swing_config", { p_club_id: clubId });
      if (error) { toast.error("Lỗi gợi ý: " + error.message); return; }
      setSuggestResult(data);
    } catch (e: any) {
      toast.error("Lỗi gợi ý: " + (e.message ?? "unknown"));
    } finally {
      setSuggestLoading(false);
    }
  };

  const applySuggest = () => {
    if (!suggestResult) return;
    const base = Math.max(30, suggestResult.suggested_base_duration);
    onChange({
      swing_duration_minutes: base,
      base_duration_minutes: base,
      target_ratio: suggestResult.suggested_target_ratio,
      break_duration_minutes: suggestResult.suggested_break_duration,
      pre_announce_minutes: Math.min(15, Math.max(5, Math.round(base / 3))),
      min_duration_minutes: Math.max(30, Math.round(base * 0.5)),
      max_duration_minutes: Math.round(base * 1.5),
    });
    toast.success("Đã áp dụng thông số gợi ý. Nhấn Lưu để ghi vào DB.");
    setSuggestResult(null);
  };

  const suggestBadge = (status: string) => {
    if (status === "understaffed") return { text: "Thiếu dealer", color: "bg-red-500/20 text-red-500" };
    if (status === "overstaffed") return { text: "Đủ dealer", color: "bg-green-500/20 text-green-500" };
    return { text: "Bình thường", color: "bg-yellow-500/20 text-yellow-500" };
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-3 mb-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium">Tự động điều chỉnh thời gian swing</p>
          <p className="text-[10px] text-muted-foreground">Dựa trên tỷ lệ dealer / bàn hiện tại</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="text-xs h-7" onClick={suggest} disabled={suggestLoading}>
            {suggestLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
            Gợi ý thông số
          </Button>
          <Switch
            checked={autoAdjust}
            onCheckedChange={(val) => onChange({ auto_adjust_duration: val ? 1 : 0 })}
          />
        </div>
      </div>

      {suggestResult && suggestResult.active_tables > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Thông số gợi ý</span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${suggestBadge(suggestResult.staffing_status).color}`}>
              {suggestBadge(suggestResult.staffing_status).text}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Base</span>
              <p className="font-mono font-semibold">{suggestResult.suggested_base_duration} phút</p>
            </div>
            <div>
              <span className="text-muted-foreground">Break</span>
              <p className="font-mono font-semibold">{suggestResult.suggested_break_duration} phút</p>
            </div>
            <div>
              <span className="text-muted-foreground">Target Ratio</span>
              <p className="font-mono font-semibold">{suggestResult.suggested_target_ratio}</p>
            </div>
          </div>
          {suggestResult.note && (
            <p className="text-[10px] text-muted-foreground italic">{suggestResult.note}</p>
          )}
          <div className="flex justify-end">
            <Button size="sm" variant="default" className="text-xs h-7" onClick={applySuggest}>
              <Zap className="w-3 h-3 mr-1" /> Áp dụng
            </Button>
          </div>
        </div>
      )}

      {autoAdjust && (
        <>
          <div className="rounded bg-muted/50 px-3 py-2 text-xs flex items-center gap-3">
            {loading ? (
              <span className="text-muted-foreground">Đang tính...</span>
            ) : (
              <>
                <span>Thời gian hiệu lực: <strong>{effectiveDuration ?? "—"} phút</strong></span>
                {staffingLabel && (
                  <span className={`font-medium ${staffingLabel.color}`}>
                    {staffingLabel.text} {poolRatio != null && `(${poolRatio.toFixed(2)})`}
                  </span>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px]">Base Duration (phút)</Label>
              <Input type="number" min={30} max={120}
                className="h-8 font-mono text-xs"
                value={baseDuration}
                onChange={(e) => onChange({ base_duration_minutes: Number(e.target.value) })} />
              <p className="text-[10px] text-muted-foreground mt-0.5">Khi ratio = target</p>
            </div>
            <div>
              <Label className="text-[11px]">Target Ratio</Label>
              <Input type="number" min={0.5} max={3.0} step={0.1}
                className="h-8 font-mono text-xs"
                value={targetRatio}
                onChange={(e) => onChange({ target_ratio: Number(e.target.value) })} />
              <p className="text-[10px] text-muted-foreground mt-0.5">Dealer/bàn "bình thường"</p>
            </div>
            <div>
              <Label className="text-[11px]">Min Duration (phút)</Label>
              <Input type="number" min={30} max={Math.max(baseDuration - 1, 30)}
                className="h-8 font-mono text-xs"
                value={minDuration}
                onChange={(e) => onChange({ min_duration_minutes: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-[11px]">Max Duration (phút)</Label>
              <Input type="number" min={baseDuration + 1} max={180}
                className="h-8 font-mono text-xs"
                value={maxDuration}
                onChange={(e) => onChange({ max_duration_minutes: Number(e.target.value) })} />
            </div>
          </div>

          {/* Visual range bar */}
          <div className="text-[10px] text-muted-foreground flex justify-between">
            <span>Min: {minDuration}m</span>
            <span>Base: {baseDuration}m</span>
            <span>Max: {maxDuration}m</span>
          </div>
          <div className="relative h-2 rounded bg-muted overflow-hidden">
            <div className="absolute h-full bg-primary/30 rounded w-full" />
            <div className="absolute h-full w-0.5 bg-primary"
              style={{ left: `${basePct}%` }} />
            {effectivePct != null && (
              <div className="absolute h-full w-1 bg-green-500 rounded"
                style={{ left: `${effectivePct}%` }} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SwingConfigDialog({ open, onOpenChange, clubId, currentConfigs, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clubId: string;
  currentConfigs: SwingConfig[];
  onSaved: () => void;
}) {
  const defaultForm = useCallback(() => ({
    tournament: {
      swing_duration_minutes: 30, break_duration_minutes: 20, warn_at_minutes: 5,
      crit_at_minutes: 1, tournament_mode: "time", pre_announce_minutes: 10,
      auto_adjust_duration: false, base_duration_minutes: 30,
      target_ratio: 1.2, min_duration_minutes: 30, max_duration_minutes: 60,
    },
  }), []);

  const [form, setForm] = useState<Record<string, any>>(defaultForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next = defaultForm();
    for (const cfg of currentConfigs) {
      if (next[cfg.table_type]) {
        next[cfg.table_type] = {
          swing_duration_minutes: Math.max(30, cfg.swing_duration_minutes),
          break_duration_minutes: cfg.break_duration_minutes,
          warn_at_minutes: cfg.warn_at_minutes,
          crit_at_minutes: cfg.crit_at_minutes,
          tournament_mode: (cfg as any).tournament_mode ?? "time",
          pre_announce_minutes: (cfg as any).pre_announce_minutes ?? 10,
          auto_adjust_duration: (cfg as any).auto_adjust_duration ?? false,
          base_duration_minutes: Math.max(30, (cfg as any).base_duration_minutes ?? 30),
          target_ratio: (cfg as any).target_ratio ?? 1.2,
          min_duration_minutes: Math.max(30, (cfg as any).min_duration_minutes ?? 30),
          max_duration_minutes: (cfg as any).max_duration_minutes ?? 60,
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
    const types = ["tournament"];
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
        pre_announce_minutes: vals.pre_announce_minutes ?? 10,
        auto_adjust_duration: vals.auto_adjust_duration ?? false,
        base_duration_minutes: vals.base_duration_minutes ?? 30,
        target_ratio: vals.target_ratio ?? 1.2,
        min_duration_minutes: vals.min_duration_minutes ?? 20,
        max_duration_minutes: vals.max_duration_minutes ?? 60,
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
            <Input type="number" min={30} max={240}
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
          <div>
            <Label className="text-[11px]">Pre-Announce (min before)</Label>
            <Input type="number" min={5} max={15}
              className="h-8 font-mono text-xs"
              value={v.pre_announce_minutes ?? 10}
              onChange={(e) => update(type, "pre_announce_minutes", Number(e.target.value))} />
          </div>
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
          {form.tournament && (
            <AutoAdjustSection
              clubId={clubId}
              autoAdjust={form.tournament.auto_adjust_duration}
              baseDuration={form.tournament.base_duration_minutes}
              targetRatio={form.tournament.target_ratio}
              minDuration={form.tournament.min_duration_minutes}
              maxDuration={form.tournament.max_duration_minutes}
              onChange={(patch) => {
                for (const [k, v] of Object.entries(patch)) {
                  update("tournament", k, v);
                }
              }}
            />
          )}
          {section("Tournament", "tournament")}
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
/* ==============================================================
   AUDIT LOG SECTION — auto-scroll with unread badge
   ============================================================== */
function AuditLogSection({ logs }: { logs: any[] }) {
  const { containerRef, unread, isPaused, scrollToBottom, handleScroll } = useAutoScrollLog(logs);

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground">NHẬT KÝ HOẠT ĐỘNG</span>
        <span className="text-[10px] text-muted-foreground">{logs.length} mục</span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="space-y-1.5 overflow-y-auto max-h-[20vh] scroll-smooth"
        style={{ scrollBehavior: "smooth" }}
      >
        {logs.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">Chưa có hoạt động.</div>
        ) : (
          logs.map((log: any) => (
            <div key={log.id} className="text-[11px] text-muted-foreground border-l-2 border-border pl-2 py-0.5">
              <span className="font-semibold text-foreground">{log.action}</span>
              <span className="block truncate">{new Date(log.created_at).toLocaleTimeString("vi-VN")}</span>
            </div>
          ))
        )}
      </div>
      {isPaused && unread > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full bg-primary text-primary-foreground text-[10px] font-bold px-3 py-1 rounded-full shadow-lg whitespace-nowrap hover:opacity-85 transition-opacity z-10"
        >
          ↓ {unread} log mới
        </button>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    "Sẵn sàng": "bg-emerald-500/20 text-emerald-500",
    "Đang bàn": "bg-blue-500/20 text-blue-500",
    "Đang nghỉ": "bg-amber-500/20 text-amber-500",
    "Đang chờ": "bg-purple-500/20 text-purple-500",
  };
  return (
    <span className={`text-[10px] px-1.5 py-[1px] font-medium ${colors[status] ?? "bg-muted text-muted-foreground"} rounded-none`}>
      {status}
    </span>
  );
}
