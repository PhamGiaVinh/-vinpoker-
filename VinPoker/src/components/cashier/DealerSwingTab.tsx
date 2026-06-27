import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  useOptimisticDealerCount, useNextDealerPredictions, useTodayCheckedOutDealers, useBreakPool,
} from "@/hooks/useDealerSwing";
import type { BreakPoolEntry, DealerAssignment, DealerAttendance, SwingConfig, ShiftBreakPolicy, PreAssignedInfo, NextDealerPrediction } from "@/hooks/useDealerSwing";
import { useRotationSchedule } from "@/hooks/useRotationSchedule";
import type { RotationScheduleRow, RotationTableSlots } from "@/hooks/useRotationSchedule";
import { useActiveTournaments } from "@/hooks/useTournaments";
import type { TournamentWithTables } from "@/types/tournament";
import AttentionQueue from "./command-center/AttentionQueue";
import OperationsCard from "./command-center/OperationsCard";
import QuickLinksCard from "./command-center/QuickLinksCard";
import { useLiveClock } from "@/hooks/useLiveClock";
import { getPreAssignStatusLabel } from "@/lib/dealerSwingState";
import { BREAK_SOON_WARNING_MINUTES, getBreakTiming, getBreakVisualState, buildRestMinutesByClub, isAssignableDealer } from "@/lib/breakPoolState";
import { useAllDealers, useDealerScores } from "@/hooks/useDealerManagement";
import { useSwingAnimation } from "@/hooks/useSwingAnimation";
import { useFocusNavigation } from "@/hooks/useFocusNavigation";
import DealerManagementTab from "./DealerManagementTab";
import { TableCardKebab } from "./TableCardKebab";
import ChangePredictedDealerModal from "./ChangePredictedDealerModal";
import CorrectWrongTableDealerModal from "./CorrectWrongTableDealerModal";
import ReconcileRoomWizard from "./ReconcileRoomWizard";
import DealerSwingSummaryStrip from "./dealer-swing/DealerSwingSummaryStrip";
import { TierBadge, TableTypeBadge, StatusPill } from "./dealer-swing/SwingBadges";
import DealerSwingInfraHealth from "./dealer-swing/DealerSwingInfraHealth";
import { useDealerSwingHealth } from "@/hooks/useDealerSwingHealth";
import SwingTableActions from "./dealer-swing/SwingTableActions";
import StatusFilterChips, { type StatusFilterValue } from "./dealer-swing/StatusFilterChips";
import SwingTableCard, { type ConfirmSwingRequest } from "./dealer-swing/SwingTableCard";
import { deriveTableSwingView, deriveDealerTableStatus, formatTimeHHmm, type TableTimeline } from "./dealer-swing/swingTableView";
import DealerStatusLegend from "./dealer-swing/DealerStatusLegend";
import DealerSearchPanel from "./dealer-swing/DealerSearchPanel";
import { FeatureTablePoolBox } from "./dealer-swing/FeatureTablePoolBox";
import CloseTourDialog, { type CloseTourPreview } from "./dealer-swing/CloseTourDialog";
import { FEATURES } from "@/lib/featureFlags";
import { exportToExcel } from "@/lib/exportExcel";
import { calculateLiveWorkedMinutes } from "@/lib/dealerWorkedMinutes";
import {
  Users, Table2, Bell, Play, RefreshCw, UserPlus, UserMinus,
  FileSpreadsheet, Loader2, Clock, AlertTriangle, Coffee,
  Plus, MessageCircle, Save, Settings, Trash2, Zap, LayoutDashboard, UserCog, ChevronDown, X, Archive,
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

/** Numeric part of a table name ("Bàn 15" → 15) for 1→100 ordering. */
function tableNumberOf(name: unknown): number {
  const m = String(name ?? "").match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
}

function resolveTableSwingTiming(
  assignment: DealerAssignment,
  table: any | undefined,
  tournaments: TournamentWithTables[] | undefined,
  swingConfigs: SwingConfig[] | null | undefined,
  nowMs: number,
): TableTimeline {
  const tableType = table?.table_type ?? assignment.game_tables?.table_type ?? "tournament";
  const tableTournament = tournaments?.find((tr) =>
    tr.tournament_tables.some((tt) => tt.table_id === assignment.table_id)
  );
  const swingDurationMinutes =
    tableTournament?.swing_duration_minutes
    ?? swingConfigs?.find((c) => c.table_type === tableType)?.swing_duration_minutes
    ?? 30;
  const warnAtMinutes =
    tableTournament?.warn_at_minutes
    ?? swingConfigs?.find((c) => c.table_type === tableType)?.warn_at_minutes
    ?? 5;

  const assignedAtMs = new Date(assignment.assigned_at).getTime();
  const nominalDueMs = Number.isFinite(assignedAtMs)
    ? assignedAtMs + swingDurationMinutes * 60_000
    : null;
  const actualDueMs = assignment.swing_due_at
    ? new Date(assignment.swing_due_at).getTime()
    : nominalDueMs;

  const nominalRemainingMs = nominalDueMs != null ? nominalDueMs - nowMs : 0;
  const actualRemainingMs = actualDueMs != null ? actualDueMs - nowMs : 0;
  const minutesLeft = nominalDueMs != null ? Math.max(0, nominalRemainingMs / 60_000) : 0;
  const actualMinutesLeft = actualDueMs != null ? Math.max(0, actualRemainingMs / 60_000) : 0;
  // isOverdue is strictly `now > swing_due_at` (fall back to nominal due only
  // when the assignment has no swing_due_at at all).
  const swingDueMs = assignment.swing_due_at
    ? new Date(assignment.swing_due_at).getTime()
    : nominalDueMs;

  return {
    minutesLeft,
    showNextDealerSoon: nominalDueMs != null ? minutesLeft <= warnAtMinutes : false,
    isOverdue: swingDueMs != null ? nowMs > swingDueMs : false,
    nominalDueAt: nominalDueMs != null ? new Date(nominalDueMs).toISOString() : null,
    actualDueAt: actualDueMs != null ? new Date(actualDueMs).toISOString() : null,
    actualMinutesLeft,
    plannedReliefAt: assignment.planned_relief_at ?? null,
  };
}

/* ==============================================================
   SWING PANEL — Main 3-Column Layout
   ============================================================== */

// C1 — explainability labels for the assign modal.
// Maps the real ScoreBreakdown fields (from pickNextDealer) to Vietnamese labels
// so the per-candidate score popover shows WHY a dealer scored as it did.
const SCORE_LABELS: Record<string, string> = {
  rest_bonus: "Nghỉ ngơi",
  tier_bonus: "Xếp hạng",
  skill_bonus: "Kỹ năng",
  mixed_bonus: "Mixed",
  priority_swing_bonus: "Bàn ưu tiên",
  consecutive_penalty: "Liên tục",
  heavy_worker_penalty: "Làm nhiều ca",
  consecutive_high_penalty: "Nhiều bàn HIGH",
  tier_back_to_back_penalty: "Bàn cũ (tier)",
  back_to_back_penalty: "Bàn cũ",
  break_equity_penalty: "Công bằng nghỉ",
  priority_break_penalty: "Cần nghỉ ưu tiên",
  fatigue_penalty: "Quá tải",
};

// Maps PickDiagnostics exclusion counters → "why this dealer was NOT chosen".
const DIAG_LABELS: Record<string, string> = {
  busy_excluded: "đang bận bàn khác",
  on_break_excluded: "đang nghỉ chưa đủ",
  break_pool_guard_excluded: "vừa swing (cooldown)",
  min_rest_excluded: "chưa nghỉ đủ giữa ca",
  inter_swing_cooldown_excluded: "cooldown giữa swing",
  fatigue_excluded: "quá tải (4+ ca liên tục)",
  priority_break_excluded: "cần nghỉ ưu tiên",
  tier_excluded: "tier C không hợp bàn HIGH",
  game_type_excluded: "không đúng loại game",
  meal_break_excluded: "đang nghỉ ăn",
  exclude_set_excluded: "đã xét cho bàn khác cùng lượt",
  step5b_pre_assigned_refs: "đã pre-assign bàn khác",
  step5c_pre_assigned: "đã pre-assign bàn khác",
};

export default function SwingPanel({ clubIds, clubs, onOpenPayroll }: { clubIds: string[]; clubs: ClubRow[]; onOpenPayroll?: () => void }) {
  const [clubFilter, setClubFilter] = useState<string | null>(clubIds.length === 1 ? clubIds[0] : null);
  const filteredClubIds = useMemo(() => {
    const ids = clubFilter ? [clubFilter] : clubIds;
    return [...ids].sort();
  }, [clubFilter, clubIds]);
  const [selectedTour, setSelectedTour] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  const [mobileTab, setMobileTab] = useState<"map" | "left" | "right">("map");
  const nowMs = useLiveClock();

  const { data: dealers, loading: dealersLoading, error: dealersError, refetch: refetchDealers } = useCheckedInDealers(filteredClubIds);
  const { data: checkedOutDealers, refetch: refetchCheckedOut } = useTodayCheckedOutDealers(filteredClubIds);
  const { data: allDealers } = useAllDealers(filteredClubIds);
  const { data: tables, loading: tablesLoading, error: tablesError, refetch: refetchTables } = useActiveTables(filteredClubIds);
  const { data: availableTables, error: availableTablesError, refetch: refetchAvailableTables } = useAvailableTables(filteredClubIds);
  const { data: poolTables, loading: poolLoading, error: poolError, refetch: refetchPoolTables } = usePoolTables(filteredClubIds);
  const { data: assignments, loading: assignsLoading, refetch: refetchAssignments } = useActiveAssignmentsWithTimeline(filteredClubIds);
  const preAssignedMap = usePreAssignedDealers(assignments);
  const { byTableId: scheduleByTableId } = useRotationSchedule(filteredClubIds);
  const { data: swingConfigs, refetch: refetchSwingConfigs } = useSwingConfigs(filteredClubIds);
  const { data: tournaments } = useActiveTournaments(clubFilter ?? filteredClubIds[0]);
  const tablesById = useMemo(() => {
    return new Map((tables ?? []).map((table) => [table.id, table]));
  }, [tables]);
  const { data: breakPool, loading: breakPoolLoading, error: breakPoolError, refetch: refetchBreakPool } =
    useBreakPool(filteredClubIds, dealers ?? [], swingConfigs ?? []);

  const timelineByTableId = useMemo(() => {
    const map: Record<string, TableTimeline> = {};
    for (const a of assignments ?? []) {
      const table = tablesById.get(a.table_id);
      map[a.table_id] = resolveTableSwingTiming(a, table, tournaments, swingConfigs, nowMs);
    }
    return map;
  }, [assignments, tablesById, tournaments, swingConfigs, nowMs]);
  const { data: swingMetrics } = useSwingMetrics(filteredClubIds);
  // C2 — read-only swing-engine infra health (lock/lease, pre-announce queue, cron liveness).
  // Degrades gracefully: hidden until the get_dealer_swing_health RPC is applied live.
  const { data: swingHealth, unavailable: swingHealthUnavailable } = useDealerSwingHealth(filteredClubIds);
  const breakPolicies = useBreakPolicies(filteredClubIds);
  const { data: specialDates, refetch: refetchSpecialDates } = useSpecialDates(filteredClubIds);
  const auditLogs = useAuditLogs(filteredClubIds, 15);
  const { data: tours, refetch: refetchTours } = useTours(filteredClubIds);
  const restingAttendanceIds = useMemo(() => {
    const set = new Set<string>();
    for (const entry of breakPool ?? []) {
      if (entry.breakType === "rest") set.add(entry.attendanceId);
    }
    return set;
  }, [breakPool]);

  const rosterDealers = useMemo(
    () => (dealers ?? []).filter(
      (dealer) => dealer.current_state !== "on_break" && !restingAttendanceIds.has(dealer.id),
    ),
    [dealers, restingAttendanceIds],
  );

  // Manual "Gán dealer" dropdown: only dealers eligible to be assigned right now —
  // hide dealers currently dealing at another table, and dealers (available or
  // on-break) who haven't rested the club's min_inter_swing_rest_minutes yet.
  const restMinutesByClub = useMemo(() => buildRestMinutesByClub(swingConfigs ?? []), [swingConfigs]);
  const assignableDealers = useMemo(
    () => (dealers ?? []).filter((d) =>
      isAssignableDealer(
        { current_state: d.current_state, last_released_at: d.last_released_at, clubId: d.dealers?.club_id ?? null },
        restMinutesByClub,
        nowMs,
      ),
    ),
    [dealers, restMinutesByClub, nowMs],
  );
  const { optimistic: checkedInCount, onCheckout: onOptCheckout } = useOptimisticDealerCount(rosterDealers.length);
  const { data: nextDealerMap } = useNextDealerPredictions(filteredClubIds, assignments);

  // ── Tournament config for swing override display ─────────────────────────
  const [processing, setProcessing] = useState<string | null>(null);
  const [swingAllBusy, setSwingAllBusy] = useState(false);
  const [swingingTableId, setSwingingTableId] = useState<string | null>(null);
  const [massAssignBusy, setMassAssignBusy] = useState(false);
  const [autoSwingEnabled, setAutoSwingEnabled] = useState(false);
  const [activeView, setActiveView] = useState<"roster" | "tables" | "dealers" | "payroll">("tables");
  const [modalTable, setModalTable] = useState<string | null>(null);
  const [changePredictedTableId, setChangePredictedTableId] = useState<string | null>(null);
  const [correctWrongTableId, setCorrectWrongTableId] = useState<string | null>(null);
  const [roomReconcileOpen, setRoomReconcileOpen] = useState(false);
  const [manualDealerId, setManualDealerId] = useState<string>("");
  const [suggestions, setSuggestions] = useState<any[] | null>(null);
  // C1: exclusion counters from the suggestions endpoint — "why other dealers
  // were not chosen". Read-only display; does not affect assignment.
  const [assignDiag, setAssignDiag] = useState<Record<string, number> | null>(null);
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

  // Break duration dialog state
  const [breakDurationOpen, setBreakDurationOpen] = useState<string | null>(null);
  // V3 Priority Lane (top, full-width) — its own final-handoff confirm so the
  // TableGrid card-swing wiring stays untouched. perform_swing itself unchanged.
  const [laneConfirmSwing, setLaneConfirmSwing] = useState<ConfirmSwingRequest | null>(null);

  // Default break duration from swing_config, ref for timer callback stability
  const defaultBreakMinutes = useMemo(() => {
    if (!clubFilter) return 15;
    const cfg = (swingConfigs ?? []).find((c: any) => c.club_id === clubFilter);
    return cfg?.break_duration_minutes ?? 15;
  }, [swingConfigs, clubFilter]);

  const defaultBreakMinutesRef = useRef<number>(15);
  useEffect(() => {
    defaultBreakMinutesRef.current = defaultBreakMinutes;
  }, [defaultBreakMinutes]);

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
  const [deleteTour, setDeleteTour] = useState<{ id: string; name: string } | null>(null);
  const [closeTourOpen, setCloseTourOpen] = useState(false);
  const [closingTour, setClosingTour] = useState(false);
  const [deletingTour, setDeletingTour] = useState(false);

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
    const hasActivePoolTables = tables.some(t => t.status === "active" && t.shift_id == null);
    if (!hasTables && !hasActivePoolTables) setAutoSwingEnabled(false);
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

  const { user, isClubAdmin } = useAuth();

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

  // ── Room summary KPIs for the operator-panel top strip (UI Phase 4) ──
  // Derived from existing data only — no new query.
  const summaryCounts = useMemo(() => {
    const activeList = (tables ?? []).filter((t) => t.status === "active");
    const activeTableIds = new Set(activeList.map((t) => t.id));
    // Count ONLY genuinely-active assignments on a still-open table. Ghost rows
    // (status='assigned' on a closed/inactive table — left by a close-table
    // race) must not inflate this, so "bàn có dealer" can never exceed "bàn
    // đang mở" (no more nonsensical 15/13).
    const assignedTables = (assignments ?? []).filter(
      (a) => a.status === "assigned" && !a.released_at && activeTableIds.has(a.table_id),
    ).length;
    // Diagnostic: assignments still 'assigned' but pointing at a non-active
    // table — these are ghosts (operator/admin signal only).
    const ghostAssignments = (assignments ?? []).filter(
      (a) => a.status === "assigned" && !a.released_at && !activeTableIds.has(a.table_id),
    ).length;
    // "Đang nghỉ" = mọi dealer đang trong Break Pool (nghỉ/cơm/break) — khớp số
    // hiển thị ở BREAK POOL. (current_state==="on_break" bỏ sót dealer đang "rest".)
    const onBreak = (breakPool ?? []).length;
    let predictedPending = 0, overdue = 0, predictedMissing = 0, emptyActive = 0;
    for (const t of activeList) {
      const tl = timelineByTableId[t.id];
      if (tl?.showNextDealerSoon) {
        predictedPending++;
        if (!nextDealerMap?.[t.id]?.nextDealerName && !preAssignedMap?.[t.id]) predictedMissing++;
      }
      if (tl?.isOverdue) overdue++;
      if (tableAssignmentMap[t.id] == null) emptyActive++;
    }
    return {
      activeTables: activeList.length,
      assignedTables,
      ghostAssignments,
      onBreak,
      predictedPending,
      overdue,
      warnings: emptyActive + predictedMissing,
    };
  }, [tables, assignments, breakPool, timelineByTableId, nextDealerMap, preAssignedMap, tableAssignmentMap]);

  // Performance KPIs (UI Phase 4 — "Hiệu suất" card). Derived from existing data:
  // stability = successful/total swings today; earliest-shortage = soonest
  // planned_relief_at among rotation slots flagged is_shortage.
  const performanceKpis = useMemo(() => {
    let total = 0, ok = 0;
    for (const m of swingMetrics ?? []) {
      total += (m as any).total_swings ?? 0;
      ok += (m as any).successful_swings ?? 0;
    }
    const stabilityPct = total > 0 ? Math.round((ok / total) * 100) : null;

    let earliestMs: number | null = null;
    for (const slots of Object.values(scheduleByTableId ?? {})) {
      for (const s of [slots?.slot0, slots?.slot1, slots?.slot2]) {
        if (s?.is_shortage && s.planned_relief_at) {
          const ms = new Date(s.planned_relief_at).getTime();
          if (Number.isFinite(ms) && (earliestMs == null || ms < earliestMs)) earliestMs = ms;
        }
      }
    }
    return { stabilityPct, earliestShortageLabel: earliestMs != null ? formatTimeHHmm(earliestMs) : null };
  }, [swingMetrics, scheduleByTableId]);

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

  // Manual swing: perform swing for a single assignment only (no side effects on other tables)
  const swingingRef = useRef(false);
  const performSwingForTable = async (assignmentId: string) => {
    if (swingingRef.current) return; // prevent double-click (ref is synchronous)
    swingingRef.current = true;
    setSwingingTableId(assignmentId);
    try {
      const { data, error } = await supabase.rpc("perform_swing", {
        p_assignment_id: assignmentId,
      });
      if (error) {
        toast.error(`Lỗi swing: ${error.message}`);
        console.error("[performSwingForTable]", error);
        return;
      }
      const result = data as any;
      const outcome = result?.outcome;
      if (outcome === "race_lost" || outcome === "version_conflict") {
        toast.warning("Bàn này vừa được xử lý bởi người khác. Đang cập nhật...");
      } else if (outcome === "no_dealer" || outcome === "no_dealer_available") {
        toast.warning("Không đủ dealer khả dụng để thay thế.");
      } else if (outcome === "not_found" || outcome === "state_mismatch") {
        toast.warning("Assignment không còn hiệu lực. Đang cập nhật...");
      } else if (outcome === "enforce_next_swing") {
        toast.info(result?.message ?? "Dealer tiếp theo cần nghỉ sớm, sẽ swing tiếp.");
      } else if (outcome === "swung" || outcome === "swung_to_break" || outcome === "swung_to_pool") {
        toast.success("Swing thành công!");
      } else if (outcome === "error") {
        toast.error(`Lỗi: ${result?.message ?? "Unknown"}`);
      } else {
        toast.success("Swing thành công!");
      }
      await Promise.all([
        refetchAssignments(),
        refetchDealers(),
      ]);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSwingingTableId(null);
      swingingRef.current = false;
    }
  };

  // Mass assign: fill empty tables. Returns assigned count.
  const massAssign = async (): Promise<number> => {
    const cid = clubFilter || filteredClubIds[0];
    if (!cid) { toast.error("Vui lòng chọn CLB"); return 0; }
    setMassAssignBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mass-assign", {
        // B1.3 — per-action idempotency key: a retried/duplicate delivery returns the cached
        // "N assigned" instead of re-running fillEmptyTables (no double-assign).
        body: { club_id: cid, shift_id: selectedTour ?? undefined, idempotency_key: crypto.randomUUID() },
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
    setAssignDiag(null);
    try {
      const { data, error } = await supabase.functions.invoke("assign-dealer", {
        body: { table_id: tableId, requested_by: user?.id, return_suggestions_only: true, shift_id: selectedTour ?? undefined },
      });
      if (error) { toast.error(`Lỗi gợi ý: ${error.message}`); return; }
      setSuggestions((data as any)?.suggestions ?? []);
      setAssignDiag((data as any)?.diagnostics ?? null);
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
        let status: number | undefined;
        if (error instanceof FunctionsHttpError) {
          const body = await error.context.json().catch(() => null);
          status = error.context.status;
          detail = body?.error ?? body?.message ?? detail;
          console.error("[confirmAssign] edge function returned:", { status, body });
        }
        // 409 = table already has an active dealer (cron may have auto-assigned)
        if (status === 409) {
          toast.info("Bàn đã có dealer — tự động cập nhật...");
          refetchAssignments();
          return;
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

  // Send dealer to break with configurable duration
  const sendToBreak = async (attendanceId: string, durationMinutes: number) => {
    setProcessing(attendanceId);
    try {
      const { data, error } = await supabase.functions.invoke("manage-break", {
        // B1.3 — per-action idempotency key: a retried/duplicate "start" returns the cached
        // result instead of extending the break / inserting a second break row.
        body: { attendance_id: attendanceId, action: "start", requested_by: user?.id, club_id: clubFilter ?? filteredClubIds[0], duration_minutes: durationMinutes, idempotency_key: crypto.randomUUID() },
      });
      if (error) {
        let errorBody: any = null;
        if (error instanceof FunctionsHttpError) {
          try {
            errorBody = await error.context?.json?.();
          } catch {
            errorBody = null;
          }
        }
        toast.error(errorBody?.error ?? error.message);
        return;
      }
      const response = data as any;
      const isExtended = response?.action === "extended";
      if (isExtended) {
        toast.success(`Đã gia hạn nghỉ thêm ${response.added_minutes ?? durationMinutes} phút, tổng ${response.break_minutes ?? "?"} phút`);
      } else {
        toast.success(`Đã gửi dealer đi nghỉ ${durationMinutes} phút`);
      }
      const breakDealer = (dealers ?? []).find((d) => d.id === attendanceId);
      const breakName = breakDealer?.dealers?.full_name ?? "";
      const tourName = getTourName();
      if (isExtended) {
        sendTelegram(`☕ ${breakName} được gia hạn nghỉ thêm ${response.added_minutes ?? durationMinutes} phút, tổng ${response.break_minutes ?? durationMinutes} phút${tourName ? ` (Tour: ${tourName})` : ""}.`)
          .catch(() => {});
      } else {
        const breakEnd = new Date(Date.now() + durationMinutes * 60_000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
        sendTelegram(`☕ ${breakName} bắt đầu nghỉ ${durationMinutes} phút${tourName ? ` (Tour: ${tourName})` : ""}. Dự kiến quay lại lúc: ${breakEnd}.`)
          .catch(() => {});
      }
      refetchAssignments();
      refetchDealers();
      refetchBreakPool();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProcessing(null);
      setBreakDurationOpen((prev) => (prev === attendanceId ? null : prev));
    }
  };

  // End break for dealer
  const endBreak = async (entry: BreakPoolEntry) => {
    const attendanceId = entry.attendanceId;
    const clubId = clubFilter ?? filteredClubIds[0];
    if (!clubId) {
      toast.error("Chưa chọn club");
      return;
    }
    setProcessing(attendanceId);
    try {
      const { data, error } = await supabase.functions.invoke("manage-break", {
        body: {
          attendance_id: attendanceId,
          action: entry.breakType === "meal" ? "end_meal_break" : "end",
          requested_by: user?.id,
          club_id: clubId,
        },
      });
      let response = data as any;
      let idempotent = false;

      if (error) {
        let errorBody: any = null;
        if (error instanceof FunctionsHttpError) {
          try {
            errorBody = await error.context?.json?.();
          } catch {
            errorBody = null;
          }
        }
        const status = errorBody?.status ?? errorBody?.result?.status ?? "";
        if (status === "no_open_break" || errorBody?.already_ended || errorBody?.alreadyEnded) {
          response = errorBody ?? response;
          idempotent = true;
        } else {
          toast.error(errorBody?.error ?? error.message);
          return;
        }
      } else {
        const status = response?.result?.status ?? response?.status ?? "";
        idempotent = status === "no_open_break" || response?.result?.already_ended || response?.already_ended || response?.alreadyEnded;
      }

      toast[idempotent ? "info" : "success"](idempotent ? "Dealer đã rời break trước đó" : "Dealer đã quay lại");

      if (!idempotent) {
        const backName = entry.dealerName ?? "";
        const tourName = getTourName();
        const message =
          entry.breakType === "meal"
            ? `🍚 ${backName} đã kết thúc nghỉ ăn cơm${tourName ? ` (${tourName})` : ""}.`
            : `✅ ${backName} đã quay lại từ break${tourName ? ` (Tour: ${tourName})` : ""}.`;
        sendTelegram(message);
      }

      await Promise.allSettled([
        refetchAssignments(),
        refetchDealers(),
        refetchBreakPool(),
      ]);

      if (autoSwingEnabled) {
        try {
          await autoSwingAll(clubId, selectedTour);
        } catch (autoErr) {
          console.error("[endBreak] autoSwingAll failed", autoErr);
        }
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProcessing(null);
    }
  };

  // Meal break handler
  const handleMealBreak = async (attendanceId: string) => {
    const clubId = filteredClubIds[0];
    if (!clubId) { toast.error("Chưa chọn club"); return; }
    setProcessing(attendanceId);
    try {
      const { data, error } = await supabase.functions.invoke("manage-break", {
        body: { attendance_id: attendanceId, action: "meal_break", club_id: clubId },
      });
      if (error) {
        const msg = (error as any)?.context ? await (error as any).context?.json?.() : null;
        toast.error(msg?.error ?? error.message);
        return;
      }
      if (data?.ok) {
        toast.success(`Đã đăng ký nghỉ ăn cơm: ${data.total_duration_minutes}p (${data.base_duration_minutes}p + ${data.bonus_minutes}p bonus)`);
        const mbDealer = (dealers ?? []).find((d) => d.id === attendanceId);
        const mbName = mbDealer?.dealers?.full_name ?? "";
        const tourName = getTourName();
        sendTelegram(`🍚 ${mbName} nghỉ ăn cơm ${data.total_duration_minutes}p${tourName ? ` (${tourName})` : ""}`);
      } else {
        toast.error(data?.error ?? "Không thể đăng ký nghỉ ăn cơm");
      }
      refetchDealers();
      refetchAssignments();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProcessing(null);
    }
  };

  // Compute meal break availability for each dealer
  const mealBreakAvailability = useMemo(() => {
    const map: Record<string, { available: boolean; nextAvailableAt: string | null }> = {};
    for (const d of dealers ?? []) {
      const lastMealBreak = (d as any).last_meal_break_at as string | null;
      if (!lastMealBreak) {
        map[d.id] = { available: true, nextAvailableAt: null };
        continue;
      }
      // 7 hours from last meal break start (approximation; backend calculates precisely)
      const nextAt = new Date(new Date(lastMealBreak).getTime() + 7 * 60 * 60 * 1000);
      map[d.id] = {
        available: Date.now() >= nextAt.getTime(),
        nextAvailableAt: nextAt.toISOString(),
      };
    }
    return map;
  }, [dealers]);

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
      if (r?.already_inactive) {
        // process-swing (or another session) closed it first — treat as success.
        toast.info("Bàn đã được đóng trước đó");
      } else if (r?.had_dealer) {
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

  // Archive & Close Tour — server-authoritative via the SECURITY DEFINER RPC
  // archive_and_close_dealer_tour (one transaction: snapshot → release tour
  // tables → dealers to break pool). Gated by FEATURES.dealerSwingCloseTourArchive
  // (the button is hidden when OFF, so this only runs once the flag is ON AND
  // the migration is applied live). NEVER raw-updates from the client.
  const closeTour = async () => {
    if (!selectedTour) return;
    const tour = (tours ?? []).find((t) => t.id === selectedTour);
    const clubId = (tour as any)?.club_id ?? clubFilter ?? filteredClubIds[0];
    if (!clubId) { toast.error("Thiếu thông tin club."); return; }
    setClosingTour(true);
    try {
      const { data, error } = await (supabase.rpc as any)("archive_and_close_dealer_tour", {
        p_tour_id: selectedTour,
        p_club_id: clubId,
      });
      if (error) throw new Error(error.message);
      const r = data as any;
      if (!r?.ok) {
        const msgMap: Record<string, string> = {
          permission_denied: "Bạn không có quyền đóng tour này.",
          tour_not_found: "Không tìm thấy tour.",
        };
        toast.error(msgMap[r?.outcome] ?? `Đóng tour thất bại: ${r?.outcome ?? "lỗi không xác định"}`);
        return;
      }
      if (r.outcome === "already_closed") toast.info("Tour đã được đóng trước đó.");
      else toast.success("Đã lưu trữ Swing và đóng tour thành công.");

      // Telegram summary to the club group (only on a real close, fire-and-forget) —
      // mirrors the per-table "Đóng bàn" notification for the whole-tour close.
      if (r.outcome === "ok") {
        const tourName = closeTourPreview?.tourName ?? getTourName();
        sendTelegram(
          `📦 Đóng tour ${tourName}: đã lưu trữ Swing, giải phóng ${r.tables_released ?? 0} bàn` +
          ` và đưa ${r.dealers_released ?? 0} dealer về Break Pool.`
        );
      }

      // Best-effort: download the archive snapshot as a JSON file.
      if (r.archive_id) {
        try {
          const { data: arch } = await (supabase.from("dealer_swing_archives") as any)
            .select("snapshot, archive_filename").eq("id", r.archive_id).single();
          if (arch?.snapshot) {
            const blob = new Blob([JSON.stringify(arch.snapshot, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = arch.archive_filename ?? `swing_archive_${r.archive_id}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }
        } catch { /* download is best-effort, ignore */ }
      }

      setCloseTourOpen(false);
      setSelectedTour(null);
      await Promise.all([refetchTours(), refetchTables(), refetchBreakPool?.()]);
    } catch (e: any) {
      toast.error(`Đóng tour thất bại: ${e.message}`);
    } finally {
      setClosingTour(false);
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

  // Preview summary for the "Đóng tour" (Archive & Close Tour) dialog. Derived
  // from already-loaded data only (no extra query). Counts = the tour's ACTIVE
  // tables + the dealers currently on them (who will be archived + sent to the
  // break pool on close). The authoritative counts come from the server RPC.
  const closeTourPreview = useMemo<CloseTourPreview | null>(() => {
    if (!selectedTour) return null;
    const tour = (tours ?? []).find((t) => t.id === selectedTour);
    if (!tour) return null;
    const tourTables = (tables ?? []).filter((t) => t.shift_id === selectedTour && t.status === "active");
    const tourTableIds = new Set(tourTables.map((t) => t.id));
    const live = (assignments ?? []).filter((a) => tourTableIds.has(a.table_id) && !a.released_at);
    const assignedDealers = live.filter((a) => a.status === "assigned").length;
    const onBreakDealers = live.filter((a) => a.status === "on_break").length;
    const reservedDealers = live.filter((a) => String(a.status) === "reserved").length;
    const datePart = new Date(nowMs).toISOString().slice(0, 10);
    const safeName = tour.tour_name.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40).replace(/^_+|_+$/g, "");
    return {
      tourName: tour.tour_name,
      activeTables: tourTables.length,
      assignedDealers,
      onBreakDealers,
      reservedDealers,
      archiveFilename: `swing_${safeName || "tour"}_${datePart}.json`,
    };
  }, [selectedTour, tours, tables, assignments, nowMs]);

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
    const columns = [
      { header: "Bàn", get: (row: any) => row["Bàn"] },
      { header: "Loại bàn", get: (row: any) => row["Loại bàn"] },
      { header: "Dealer", get: (row: any) => row["Dealer"] },
      { header: "Hạng", get: (row: any) => row["Hạng"] },
      { header: "Bắt đầu", get: (row: any) => row["Bắt đầu"] },
      { header: "Trạng thái", get: (row: any) => row["Trạng thái"] },
    ];
    exportToExcel(rows, columns, `shift-report-${today}`, "Shift report");
    toast.success("Đã tải báo cáo ca");
  };

  const { triggerSwingAnimation, isAnimating } = useSwingAnimation();
  const { focusedTableId, focusTable } = useFocusNavigation();

  const loading = dealersLoading || tablesLoading || assignsLoading;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {clubs.length > 1 && (
          <Select value={clubFilter ?? "all"} onValueChange={(v) => setClubFilter(v === "all" ? null : v)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Tất cả CLB" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả CLB</SelectItem>
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
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <Switch
            checked={(() => {
              const cid = clubFilter || filteredClubIds[0];
              if (!cid) return false;
              const cfg = (swingConfigs ?? []).find((c: any) => c.club_id === cid && c.table_type === "tournament");
              return cfg?.rotation_planner_enabled ?? false;
            })()}
            onCheckedChange={async (checked: boolean) => {
              const cid = clubFilter || filteredClubIds[0];
              if (!cid) { toast.error("Vui lòng chọn CLB"); return; }
              const { error } = await supabase.from("swing_config").upsert({
                club_id: cid,
                table_type: "tournament",
                rotation_planner_enabled: checked,
              }, { onConflict: "club_id, table_type" });
              if (error) { toast.error("Lỗi lưu: " + error.message); return; }
              refetchSwingConfigs();
              toast.success(checked ? "Rotation Planner đã bật" : "Rotation Planner đã tắt");
            }}
          />
          <span className="text-[11px] text-muted-foreground">Rotation</span>
        </label>
        <Button size="sm" variant="outline" onClick={() => setSwingConfigOpen(true)}>
          <Settings className="w-3.5 h-3.5 mr-1" /> Cấu hình Swing
        </Button>
      </div>

      {/* Tour Filter Bar */}
      <div className="sticky top-0 z-10 bg-background pb-2 border-b border-border">
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs font-semibold text-muted-foreground mr-1">Tour:</span>
          <button onClick={() => setSelectedTour(null)}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${selectedTour === null ? "bg-success/20 text-success border-success/50" : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"}`}>
            Tổng thể
          </button>
          {(tours ?? []).map((t) => (
            <div key={t.id} className="relative">
              <button onClick={() => { setSelectedTour(t.id); setActiveView("tables"); }}
                className={`text-xs pl-3 pr-5 py-1.5 rounded-full border transition ${selectedTour === t.id ? "bg-success/20 text-success border-success/50" : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"}`}>
                {t.tour_name} ({t.start_time?.slice(0, 5)}-{t.end_time?.slice(0, 5)})
              </button>
              <button onClick={(e) => { e.stopPropagation(); setDeleteTour({ id: t.id, name: t.tour_name }); }}
                title="Xoá tour"
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-secondary border border-border text-foreground hover:bg-destructive hover:text-white flex items-center justify-center">
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
          <button onClick={() => setCreateTourOpen(true)}
            title="Tạo tour mới (đặt tên để Telegram gửi đúng tour)"
            className="text-xs px-2.5 py-1.5 rounded-full border border-primary/40 text-primary bg-primary/10 hover:bg-primary/20 transition inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> Tạo tour
          </button>
          {FEATURES.dealerSwingCloseTourArchive && selectedTour !== null && (
            <button onClick={() => setCloseTourOpen(true)}
              title="Lưu trữ & Đóng tour"
              className="text-xs px-3 py-2 min-h-[40px] rounded-full border border-destructive/40 text-destructive bg-destructive/10 hover:bg-destructive/20 transition inline-flex items-center gap-1">
              <Archive className="w-3 h-3" /> Đóng tour
            </button>
          )}
        </div>
        {(tours ?? []).length === 0 && selectedTour === null && (
          <div className="text-xs text-warning mt-1 flex items-center gap-2">
            <span>Chưa có tour nào. </span>
            <button onClick={() => setCreateTourOpen(true)} className="underline hover:text-warning">Tạo tour mới</button>
          </div>
        )}
      </div>

      {tablesError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs p-3 rounded flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Lỗi tải bàn: {tablesError}</span>
          <Button size="sm" variant="ghost" className="ml-auto text-xs h-6" onClick={refetchTables}>Thử lại</Button>
        </div>
      )}
      {dealersError && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs p-3 rounded flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Lỗi tải dealer: {dealersError}</span>
          <Button size="sm" variant="ghost" className="ml-auto text-xs h-6" onClick={refetchDealers}>Thử lại</Button>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-96 rounded-none" />
      ) : (
        <>
        <DealerSwingSummaryStrip
          activeTables={summaryCounts.activeTables}
          assignedTables={summaryCounts.assignedTables}
          ghostAssignments={isClubAdmin ? summaryCounts.ghostAssignments : 0}
          onBreak={summaryCounts.onBreak}
          predictedPending={summaryCounts.predictedPending}
          overdue={summaryCounts.overdue}
          warnings={summaryCounts.warnings}
          stabilityPct={performanceKpis.stabilityPct}
          earliestShortageLabel={performanceKpis.earliestShortageLabel}
          nowMs={nowMs}
        />

        <DealerSwingInfraHealth
          health={swingHealth}
          clubs={clubs}
          unavailable={swingHealthUnavailable}
          nowMs={nowMs}
        />

        {/* ── PRIORITY LANE (V3) — full-width alerts band on top ── */}
        <div className="mb-4">
          <AttentionQueue
            horizontal
            assignments={assignments ?? []}
            tables={tables ?? []}
            dealers={dealers ?? []}
            tableAssignmentMap={tableAssignmentMap}
            timelineByTableId={timelineByTableId}
            nextDealerMap={nextDealerMap}
            scheduleByTableId={scheduleByTableId}
            nowMs={nowMs}
            autoSwingEnabled={autoSwingEnabled}
            onSwing={(tableId) => {
              const a = tableAssignmentMap[tableId];
              if (!a?.id) { toast.warning("Bàn này không có assignment hiệu lực hoặc dữ liệu đã cũ. Vui lòng tải lại."); return; }
              const t = (tables ?? []).find((x) => x.id === tableId);
              const currentDealer = a.dealer_attendance?.dealers?.full_name ?? "Dealer hiện tại";
              const nextDealer = a.pre_assigned_attendance_id
                ? (assignments ?? []).find((x) => x.attendance_id === a.pre_assigned_attendance_id)?.dealer_attendance?.dealers?.full_name ?? null
                : null;
              setLaneConfirmSwing({
                assignmentId: a.id,
                tableName: t?.table_name ?? "Bàn",
                outName: currentDealer,
                inName: nextDealer,
                isOt: !!a.overtime_started_at,
              });
            }}
            onAssign={openAssignModal}
            onSendToBreak={(attId) => setBreakDurationOpen(attId)}
            onFocusTable={focusTable}
          />
        </div>

        {/* Priority Lane final-handoff confirm (separate from TableGrid's) */}
        <AlertDialog open={!!laneConfirmSwing} onOpenChange={(o) => { if (!o) setLaneConfirmSwing(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {laneConfirmSwing?.isOt ? "Chốt đổi khẩn cấp" : "Chốt đổi dealer"} — {laneConfirmSwing?.tableName}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {laneConfirmSwing?.outName} sẽ ra, {laneConfirmSwing?.inName ?? "dealer do hệ thống chọn"} sẽ vào ngay.
                Đây là handoff cuối cùng — dealer hiện tại được giải phóng và swing log được ghi.
                {laneConfirmSwing?.isOt
                  ? " Bàn đang quá hạn: thao tác khẩn cấp, hãy chắc chắn dealer thay đã sẵn sàng."
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Hủy</AlertDialogCancel>
              <AlertDialogAction
                className={laneConfirmSwing?.isOt ? "bg-destructive hover:bg-destructive" : undefined}
                onClick={() => {
                  if (laneConfirmSwing) performSwingForTable(laneConfirmSwing.assignmentId);
                  setLaneConfirmSwing(null);
                }}>
                {laneConfirmSwing?.isOt ? "Chốt đổi khẩn cấp" : "Chốt đổi"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Mobile tab bar (<md only). Tablet (md–lg) stacks all 3; desktop = 3-col. */}
        <div className="md:hidden mb-3 flex gap-1 rounded-xl border border-border/60 bg-card/70 p-1">
          {([
            { k: "map", label: "Bản đồ bàn" },
            { k: "right", label: "Điều khiển" },
          ] as const).map((tab) => (
            <button
              key={tab.k}
              type="button"
              onClick={() => setMobileTab(tab.k)}
              className={cn(
                "h-10 flex-1 rounded-lg text-xs font-medium transition-colors",
                mobileTab === tab.k ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* CENTER COLUMN — battle map (first on mobile, wider in V3) */}
          <div className={cn("order-1 lg:order-none lg:col-span-8", mobileTab === "map" ? "" : "hidden md:block")}>
            {activeView === "dealers" ? (
              <>
                {selectedTour && (
                  <div className="text-xs text-warning mb-2 flex items-center gap-2">
                    <span>Tour đang chọn: {(tours ?? []).find(t => t.id === selectedTour)?.tour_name ?? selectedTour}</span>
                    <button onClick={() => setActiveView("tables")} className="underline hover:text-warning">Xem bàn</button>
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
                    scheduleByTableId={scheduleByTableId}
                    timelineByTableId={timelineByTableId}
                    swingConfigs={swingConfigs ?? []}
                    tournaments={tournaments}
                  processing={processing}
                  onAssign={openAssignModal}
onSendToBreak={(attId) => setBreakDurationOpen(attId)}
                   onAutoBreak={(attId) => sendToBreak(attId, defaultBreakMinutesRef.current)}
                   selectedTour={selectedTour}
                  searchTerm={tableSearch}
                  onCreateTable={() => setCreateTableOpen(true)}
                  closeTableConfirmId={closeTableConfirmId}
                  onCloseTableClick={setCloseTableConfirmId}
                  onCloseTableConfirm={closeTable}
                  onCloseTableCancel={() => setCloseTableConfirmId(null)}
                  closingTable={closingTable}
                  onManualSwing={openAssignModal}
                  onForceClose={setCloseTableConfirmId}
                  isAnimating={isAnimating}
                  focusedTableId={focusedTableId}
                  onSwingTable={performSwingForTable}
                  swingingAssignmentId={swingingTableId}
                  dealers={dealers ?? []}
                  onChangePredicted={setChangePredictedTableId}
                  onCorrectWrongTable={setCorrectWrongTableId}
                  onOpenRoomReconcile={() => setRoomReconcileOpen(true)}
                />
            )}
          </div>

          {/* RIGHT COLUMN — Action Rail: Relief/Break Pool → Check-in/out → Quick actions */}
          <div className={cn("order-2 lg:order-none lg:col-span-4 space-y-4 min-h-0", mobileTab === "right" ? "" : "hidden md:block")}>
            <DealerSearchPanel value={tableSearch} onChange={setTableSearch} />
            <BreakPoolCard
              entries={breakPool ?? []}
              loading={breakPoolLoading}
              error={breakPoolError}
              processing={processing}
              onEndBreak={endBreak}
              onSendToBreak={(attId) => sendToBreak(attId, defaultBreakMinutesRef.current)}
              onRetry={refetchBreakPool}
            />
            {FEATURES.dealerFeatureTables && (
              <FeatureTablePoolBox clubId={clubFilter ?? clubIds[0] ?? null} tables={tables ?? []} dealers={dealers ?? []} />
            )}
            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-card/70 px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-muted/60 [&[data-state=open]>svg]:rotate-180">
                <span className="font-display tracking-wider">ĐỘI HÌNH / CHECK-IN</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <RosterPanel
                  dealers={rosterDealers}
                  assignments={assignments ?? []}
                  swingConfigs={swingConfigs ?? []}
                  processing={processing}
                  totalDealers={allDealers?.filter(d => d.status === 'active').length ?? 0}
                  checkedInCount={checkedInCount}
                  checkedOutDealers={checkedOutDealers ?? []}
                  onSendToBreak={(attId) => setBreakDurationOpen(attId)}
                  onCheckinOpen={() => { loadCheckinDealers(); setCheckinOpen(true); }}
                  onCheckoutOpen={() => setCheckoutOpen(true)}
                  onBatchCheckout={handleBatchCheckoutClick}
                  onReCheckin={doReCheckin}
                  breakPolicies={breakPolicies ?? []}
                  onMealBreak={handleMealBreak}
                  mealBreakAvailability={mealBreakAvailability}
                />
              </CollapsibleContent>
            </Collapsible>
            <CommandCenter
              auditLogs={auditLogs ?? []}
              onAutoSwing={autoSwingAll}
              onMassAssign={massAssign}
              onExportShift={exportShiftReport}
              onExportPayroll={() => onOpenPayroll?.()}
              swingAllBusy={swingAllBusy}
              massAssignBusy={massAssignBusy}
              autoSwingEnabled={autoSwingEnabled}
              onToggleAutoSwing={toggleAutoSwing}
              clubFilter={clubFilter}
              clubs={clubs}
              onOpenSwingConfig={() => setSwingConfigOpen(true)}
              onOpenSpecialDates={() => setSpecialDatesOpen(true)}
              onAssign={openAssignModal}
              onSendToBreak={(attId) => setBreakDurationOpen(attId)}
              dealers={dealers ?? []}
              swingMetrics={swingMetrics ?? []}
              tables={tables ?? []}
              assignments={assignments ?? []}
              tableAssignmentMap={tableAssignmentMap}
              timelineByTableId={timelineByTableId}
              nextDealerMap={nextDealerMap}
              scheduleByTableId={scheduleByTableId}
              onFocusTable={focusTable}
            />
          </div>
        </div>
        </>
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
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button" title={`Điểm: ${s.score}`}
                              className="text-xs font-mono text-primary cursor-help border border-primary/30 px-1.5 py-0.5">
                              {s.score}
                            </button>
                          </PopoverTrigger>
                          {bd && (
                            <PopoverContent side="top" align="end" className="w-auto min-w-[160px] p-2 rounded-none bg-popover border-border shadow-lg">
                              <div className="text-[10px] text-muted-foreground space-y-0.5">
                                {Object.entries(SCORE_LABELS)
                                  .filter(([key]) => typeof bd[key] === "number" && bd[key] !== 0)
                                  .map(([key, label]) => (
                                    <div key={key} className="flex justify-between gap-3">
                                      <span>{label}</span>
                                      <span className={bd[key] > 0 ? "text-success" : "text-destructive"}>
                                        {bd[key] > 0 ? `+${bd[key]}` : bd[key]}
                                      </span>
                                    </div>
                                  ))}
                                <div className="border-t border-border pt-0.5 mt-0.5 flex justify-between font-semibold">
                                  <span>Tổng</span><span className="text-primary">{s.score}</span>
                                </div>
                              </div>
                            </PopoverContent>
                          )}
                        </Popover>
                        <Button size="sm" onClick={() => confirmAssign(s.dealer_id)} disabled={assigning}>
                          {assigning ? <Loader2 className="w-3 h-3 animate-spin" /> : "Gán"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
            {assignDiag && Object.keys(DIAG_LABELS).some((k) => (assignDiag[k] ?? 0) > 0) && (
              <div className="border border-border/60 bg-muted/10 rounded-none p-2 mt-1">
                <div className="text-[11px] font-semibold text-muted-foreground mb-1">
                  Vì sao dealer khác không được chọn
                  {typeof assignDiag.total_rows === "number" && (
                    <span className="font-normal"> · xét {assignDiag.total_rows} trong pool → {assignDiag.candidates_count ?? 0} đủ điều kiện</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(DIAG_LABELS)
                    .filter(([k]) => (assignDiag[k] ?? 0) > 0)
                    .map(([k, label]) => (
                      <span key={k} className="text-[10px] px-1.5 py-0.5 border border-border bg-background/40 text-muted-foreground">
                        {assignDiag[k]} {label}
                      </span>
                    ))}
                </div>
              </div>
            )}
            <div className="border-t border-border pt-3 mt-3">
              <Label className="text-xs">Gán thủ công:</Label>
              <Select value={manualDealerId} onValueChange={setManualDealerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn dealer..." />
                </SelectTrigger>
                <SelectContent>
                  {assignableDealers.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                      Không có dealer đủ điều kiện — chờ dealer rảnh / nghỉ đủ
                    </div>
                  ) : (
                    assignableDealers.map((d) => (
                      <SelectItem key={d.id} value={d.dealer_id}>
                        {(d as any).dealers?.full_name ?? d.dealer_id}
                      </SelectItem>
                    ))
                  )}
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

      {/* Đổi & CHỐT dealer thay thế — planning only, never executes the handoff */}
      {changePredictedTableId && (() => {
        const cpTable = (tables ?? []).find((x: any) => x.id === changePredictedTableId);
        const cpAssignment = tableAssignmentMap[changePredictedTableId];
        const cpSlots = scheduleByTableId?.[changePredictedTableId];
        const cpNameByAtt: Record<string, string> = {};
        for (const [tid, asg] of Object.entries(tableAssignmentMap)) {
          if (!asg) continue;
          const tn = (tables ?? []).find((x: any) => x.id === tid)?.table_name;
          if (tn) cpNameByAtt[asg.attendance_id] = tn;
        }
        const cpRestMinutes = Math.max(
          10,
          ((swingConfigs?.find((c) => (c as any).table_type === "tournament") as any)
            ?.min_inter_swing_rest_minutes as number | undefined) ?? 10,
        );
        return (
          <ChangePredictedDealerModal
            open
            onOpenChange={(o) => { if (!o) setChangePredictedTableId(null); }}
            tableName={cpTable?.table_name ?? "Bàn"}
            slot0={cpSlots?.slot0 ?? null}
            currentTableAttendanceId={cpAssignment?.attendance_id ?? null}
            dealers={dealers ?? []}
            assignedTableNameByAttendanceId={cpNameByAtt}
            restMinutes={cpRestMinutes}
            onChanged={() => { refetchAssignments(); refetchDealers(); }}
          />
        );
      })()}

      {/* Sửa nhầm bàn — REALITY correction via reconcile_dealer_room_state (#33C).
          Exact-table context resolved per click, same pattern as Đổi dự kiến above. */}
      {correctWrongTableId && (() => {
        const cwTable = (tables ?? []).find((x) => x.id === correctWrongTableId);
        if (!cwTable) return null;
        const cwRestMinutes = Math.max(
          10,
          swingConfigs?.find((c) => c.table_type === "tournament")?.min_inter_swing_rest_minutes ?? 10,
        );
        return (
          <CorrectWrongTableDealerModal
            open
            onOpenChange={(o) => { if (!o) setCorrectWrongTableId(null); }}
            clubId={cwTable.club_id}
            tableId={cwTable.id}
            tableName={cwTable.table_name ?? "Bàn"}
            recordedAssignment={tableAssignmentMap[correctWrongTableId] ?? null}
            dealers={dealers ?? []}
            tables={tables ?? []}
            tableAssignmentMap={tableAssignmentMap}
            restMinutes={cwRestMinutes}
            onApplied={() => { refetchAssignments(); refetchDealers(); }}
          />
        );
      })()}

      {/* Sửa domino nhiều bàn — multi-table room reconcile wizard (#33F). */}
      {roomReconcileOpen && (() => {
        const cid = clubFilter ?? filteredClubIds[0];
        if (!cid) return null;
        const rrRest = Math.max(
          10,
          swingConfigs?.find((c) => c.table_type === "tournament")?.min_inter_swing_rest_minutes ?? 10,
        );
        return (
          <ReconcileRoomWizard
            open
            onOpenChange={setRoomReconcileOpen}
            clubId={cid}
            dealers={dealers ?? []}
            tables={tables ?? []}
            tableAssignmentMap={tableAssignmentMap}
            restMinutes={rrRest}
            onApplied={() => { refetchAssignments(); refetchDealers(); }}
          />
        );
      })()}

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
                        <UserMinus className="w-3 h-3 text-warning" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">Check-in lại</span>
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
                            <span className="text-[10px] text-warning">(Đã kết thúc ca)</span>
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
                        <UserPlus className="w-3 h-3 text-success" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-success">Check-in mới</span>
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
                  <p className="text-warning text-sm font-medium">
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
          {/* Scope clarity: All → global table; a tour selected → scoped to that tour. */}
          <div className={[
            "text-xs px-2.5 py-1.5 rounded border",
            selectedTour
              ? "text-success border-success/30 bg-success/5"
              : "text-warning border-warning/30 bg-warning/5",
          ].join(" ")}>
            {selectedTour
              ? `Thêm bàn vào: ${(tours ?? []).find((t) => t.id === selectedTour)?.tour_name ?? "tour đang chọn"}`
              : "Thêm bàn tổng thể (không thuộc tour nào)"}
          </div>
          <div className="space-y-3">
            <Input
              placeholder="Tìm bàn..."
              value={poolSearch}
              onChange={(e) => setPoolSearch(e.target.value)}
              className="text-xs"
            />
            <div className="max-h-48 overflow-y-auto space-y-1 border border-border p-1">
              {poolError ? (
                <div className="text-xs text-destructive text-center py-4">Lỗi tải danh sách bàn: {poolError}. Vui lòng thử lại.</div>
              ) : poolLoading ? (
                <div className="text-xs text-muted-foreground text-center py-4">Đang tải...</div>
              ) : !poolTables || poolTables.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">Chưa có bàn nào trong pool.</div>
              ) : (
                (() => {
                  const excluded = ["11", "12", "13", "21", "A25"];
                  const filtered = poolTables
                    .filter((t) => !excluded.includes(t.table_name) && (!poolSearch || t.table_name.toLowerCase().includes(poolSearch.toLowerCase())))
                    .sort((a, b) => tableNumberOf(a.table_name) - tableNumberOf(b.table_name)
                      || String(a.table_name).localeCompare(String(b.table_name), "vi"));
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
                          <Badge variant="secondary" className="text-[10px] bg-warning/10 text-warning border-warning/20">Đã có dealer</Badge>
                        ) : t.status === "active" ? (
                          <Badge variant="secondary" className="text-[10px] bg-success/10 text-success border-success/20">Sẵn sàng</Badge>
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
                  // Clean up stale dealer assignments (atomic RPC — checks for other active assignments)
                  await supabase.rpc("release_dealer_from_table", { p_table_id: tableId });
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

      {/* Break Duration Dialog */}
      <BreakDurationDialog
        open={breakDurationOpen !== null}
        onOpenChange={(v) => { if (!v) setBreakDurationOpen(null); }}
        defaultMinutes={defaultBreakMinutes}
        onConfirm={(minutes) => {
          if (breakDurationOpen) sendToBreak(breakDurationOpen, minutes);
        }}
      />

      {/* Create Tour Dialog */}
      <Dialog open={createTourOpen} onOpenChange={setCreateTourOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Tạo tour mới</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tên tour</Label>
              <Input value={newTourName} onChange={(e) => setNewTourName(e.target.value)} placeholder="VD: Tour Sáng" autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && newTourName.trim()) (e.currentTarget.closest('[role="dialog"]')?.querySelector('[data-create-tour]') as HTMLButtonElement | null)?.click(); }} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Giờ bắt đầu <span className="text-muted-foreground">(tự điền nếu trống)</span></Label>
                <Input type="time" value={newTourStartTime} onChange={(e) => setNewTourStartTime(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Giờ kết thúc <span className="text-muted-foreground">(tự điền nếu trống)</span></Label>
                <Input type="time" value={newTourEndTime} onChange={(e) => setNewTourEndTime(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTourOpen(false)}>Huỷ</Button>
            <Button data-create-tour disabled={!newTourName.trim() || processing === "create_tour"}
              onClick={async () => {
                setProcessing("create_tour");
                const clubId = clubFilter ?? filteredClubIds[0];
                if (!clubId || !newTourName.trim()) { setProcessing(null); return; }
                // Quick create: name only. Auto-fill times if left blank
                // (start = now, end = +8h clamped to 23:59) — dealer_shifts
                // requires NOT NULL start_time/end_time.
                const pad = (n: number) => String(n).padStart(2, "0");
                const now = new Date();
                const startAuto = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
                const endD = new Date(now.getTime() + 8 * 3600 * 1000);
                const sameDay = endD.getDate() === now.getDate() && endD.getMonth() === now.getMonth();
                const endAuto = sameDay ? `${pad(endD.getHours())}:${pad(endD.getMinutes())}` : "23:59";
                const startVal = newTourStartTime || startAuto;
                const endVal = newTourEndTime || endAuto;
                const { data: created, error } = await supabase.from("dealer_shifts").insert({
                  club_id: clubId,
                  tour_name: newTourName.trim(),
                  start_time: startVal,
                  end_time: endVal,
                }).select("id").single();
                setProcessing(null);
                if (error) { toast.error(error.message); return; }
                toast.success(`Đã tạo tour "${newTourName.trim()}". Bấm chip tour để lọc bàn vào tour.`);
                setCreateTourOpen(false);
                setNewTourName("");
                setNewTourStartTime("");
                setNewTourEndTime("");
                await refetchTours();
                // NOTE: do NOT auto-select the new tour — selecting it would
                // filter the battle map to that (empty) tour and hide the other
                // tables, which looks like "tables disappeared". Stay on the
                // current view; the operator taps the chip when ready.
                void created;
              }}>
              {processing === "create_tour" ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Plus className="w-3.5 h-3.5 mr-1" />Tạo tour</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete tour confirmation */}
      <AlertDialog open={!!deleteTour} onOpenChange={(o) => { if (!o) setDeleteTour(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá tour "{deleteTour?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Các bàn thuộc tour này KHÔNG bị xoá — chúng trở về bàn chung (bỏ gán tour).
              Hành động này không hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive"
              disabled={deletingTour}
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteTour) return;
                setDeletingTour(true);
                const { error } = await supabase.from("dealer_shifts").delete().eq("id", deleteTour.id);
                setDeletingTour(false);
                if (error) { toast.error(error.message); return; }
                toast.success("Đã xoá tour");
                if (selectedTour === deleteTour.id) setSelectedTour(null);
                setDeleteTour(null);
                await refetchTours();
                await refetchTables();
              }}>
              {deletingTour ? <Loader2 className="w-3 h-3 animate-spin" /> : "Xoá tour"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive & Close Tour — wired to the server RPC (gated by the flag). */}
      <CloseTourDialog
        open={closeTourOpen}
        onOpenChange={setCloseTourOpen}
        preview={closeTourPreview}
        onConfirm={closeTour}
        busy={closingTour}
      />

      {/* Special Dates Dialog (Bug 6) */}
      <Dialog open={specialDatesOpen} onOpenChange={setSpecialDatesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Ngày đặc biệt</DialogTitle></DialogHeader>

          {/* Add form */}
          <div className="space-y-3 pb-4 border-b border-border">
            <p className="text-xs text-muted-foreground font-medium">Thêm ngày mới</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
    <span className="font-jetbrains tabular-nums text-[10px]">
      {h > 0 ? `${h}h ` : ""}{m}m
    </span>
  );
}

function FatigueDot({ workedMinutes, priorityBreakFlag }: { workedMinutes: number; priorityBreakFlag: boolean }) {
  const worked = workedMinutes;
  const priority = priorityBreakFlag;
  let color: string;
  if (priority || worked >= 90) color = "bg-destructive";
  else if (worked >= 60) color = "bg-warning";
  else color = "bg-success";
  return <div className={`w-2 h-2 rounded-full ${color} flex-shrink-0`} title={`Đã làm ${Math.round(worked)}p${priority ? " (ưu tiên nghỉ)" : ""}`} />;
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

function CollapsibleSection<T>({
  items,
  defaultVisible = 3,
  renderItem,
  header,
}: {
  items: T[];
  defaultVisible?: number;
  renderItem: (item: T) => React.ReactNode;
  header: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, defaultVisible);
  const hidden = items.length - defaultVisible;

  return (
    <div className="pt-2 border-t border-border/40">
      {header}
      <div className="space-y-0.5 opacity-60 hover:opacity-100 transition-opacity">
        {visible.map((item) => renderItem(item))}
      </div>
      {hidden > 0 && (
        <button
          className="w-full text-[10px] text-muted-foreground hover:text-foreground py-1.5 text-center transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? `Thu gọn` : `+${hidden} dealer khác`}
        </button>
      )}
    </div>
  );
}

function BreakDurationDialog({
  open,
  onOpenChange,
  defaultMinutes,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultMinutes: number;
  onConfirm: (minutes: number) => void;
}) {
  const presets = [15, 30, 45, 60];
  const [selected, setSelected] = useState<number>(defaultMinutes);
  const [custom, setCustom] = useState<string>("");

  useEffect(() => {
    if (open) {
      setSelected(defaultMinutes);
      setCustom("");
    }
  }, [open, defaultMinutes]);

  const parsedCustom = custom ? parseInt(custom, 10) : NaN;
  const isValidCustom = !isNaN(parsedCustom) && parsedCustom >= 5 && parsedCustom <= 120;
  const effectiveMinutes: number | null =
    custom
      ? isValidCustom ? parsedCustom : null
      : selected;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-[260px]">
        <DialogHeader>
          <DialogTitle className="text-foreground text-sm">Chọn thời gian nghỉ</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-1.5">
            {presets.map((m) => (
              <button
                key={m}
                className={`px-2 py-1.5 text-xs rounded-md transition-colors ${
                  !custom && selected === m
                    ? "bg-success text-success-foreground"
                    : "bg-muted text-foreground hover:bg-secondary"
                }`}
                onClick={() => { setSelected(m); setCustom(""); }}
              >
                {m}p
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={5}
              max={120}
              placeholder="Custom"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="h-7 text-xs bg-muted border-border text-foreground"
            />
            <span className="text-xs text-muted-foreground">phút</span>
          </div>
          <Button
            size="sm"
            className="w-full bg-success hover:bg-success text-success-foreground"
            disabled={effectiveMinutes === null}
            onClick={() => { if (effectiveMinutes !== null) onConfirm(effectiveMinutes); }}
          >
            {effectiveMinutes !== null
              ? `Xác nhận — ${effectiveMinutes} phút`
              : "Nhập 5–120 phút"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RosterPanel({
  dealers, assignments, swingConfigs, processing, totalDealers, checkedInCount,
  checkedOutDealers, onSendToBreak, onCheckinOpen, onCheckoutOpen,
  onBatchCheckout, onReCheckin, breakPolicies, onMealBreak, mealBreakAvailability,
}: {
  dealers: DealerAttendance[];
  assignments: DealerAssignment[];
  swingConfigs: SwingConfig[];
  processing: string | null;
  totalDealers: number;
  checkedInCount?: number;
  checkedOutDealers: DealerAttendance[];
  onSendToBreak: (attendanceId: string) => void;
  onCheckinOpen: () => void;
  onCheckoutOpen: () => void;
  onBatchCheckout: (ids: string[]) => void;
  onReCheckin: (dealerId: string) => void;
  breakPolicies: ShiftBreakPolicy[];
  onMealBreak: (attendanceId: string) => void;
  mealBreakAvailability: Record<string, { available: boolean; nextAvailableAt: string | null }>;
}) {
  const nowMs = useLiveClock();
  const [batchMode, setBatchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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
  const dealerStatuses = useMemo(() => {
    const map: Record<string, { status: string; tableName?: string; checkInTime: string; timerStart: string }> = {};
    for (const d of dealers) {
      const a = d.current_state === "pre_assigned"
        ? assignments.find((a) => a.pre_assigned_attendance_id === d.id && a.status === "assigned")
        : assignments.find((a) => a.attendance_id === d.id);
      const checkInTime = d.check_in_time ?? new Date().toISOString();
      if (d.current_state === "pre_assigned") {
        map[d.id] = { status: "Đang chờ", tableName: (a as any)?.game_tables?.table_name, checkInTime, timerStart: checkInTime };
      } else if (a?.status === "assigned") {
        map[d.id] = { status: "Đang bàn", tableName: (a as any).game_tables?.table_name, checkInTime, timerStart: a.assigned_at };
      } else {
        // available, or orphaned assigned with no active assignment → treat as available
        // Pass 0c will fix the DB, but UI must handle it gracefully
        if (d.current_state === "assigned") {
          console.warn(`[DealerSwingTab] Orphaned assigned state: dealer ${d.id} has no active assignment`);
        }
        map[d.id] = { status: "Sẵn sàng", tableName: undefined, checkInTime, timerStart: checkInTime };
      }
    }
    return map;
  }, [dealers, assignments]);

  // Live worked minutes: compute from assignment timestamps, not stale column.
  // Assigned → elapsed since assigned_at; others → stored value (last session).
  const liveWorkedMin = useMemo(
    () => calculateLiveWorkedMinutes(dealers, assignments, nowMs),
    [dealers, assignments, nowMs]
  );

  // Urgency key for sorting assigned dealers
  const urgencyKey = useCallback((att: DealerAssignment | undefined): number => {
    if (!att) return 999;
    if (att.overtime_started_at) return 0;
    const ms = new Date(att.swing_due_at).getTime() - nowMs;
    if (ms <= 0) return 1;
    if (ms <= 120000) return 2;
    if (ms <= 300000) return 3;
    return 4;
  }, [nowMs]);

  // Search filter across name / username / table name
  const filteredDealers = useMemo(() => {
    if (!searchQuery.trim()) return dealers;
    const q = searchQuery.toLowerCase();
    return dealers.filter((d) => {
      const dd = d.dealers;
      if (dd?.full_name?.toLowerCase().includes(q)) return true;
      if (dd?.telegram_username?.toLowerCase().includes(q)) return true;
      const info = dealerStatuses[d.id];
      if (info?.tableName?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [dealers, searchQuery, dealerStatuses]);

  const sections = [
    { key: "Sẵn sàng", icon: Users, color: "text-success", dot: "bg-success" },
    { key: "Đang bàn", icon: Table2, color: "text-[hsl(var(--ds-active))]", dot: "bg-[hsl(var(--ds-active))]" },
    { key: "Đang chờ", icon: Clock, color: "text-[hsl(var(--ds-preassign))]", dot: "bg-[hsl(var(--ds-preassign))]" },
  ] as const;

  return (
    <Card className="p-3 flex flex-col flex-1 min-h-0">
      {/* ── Header: title + batch toggle ── */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <span className="font-display text-sm tracking-wider">ĐỘI HÌNH</span>
        </div>
        <Button size="sm" variant={batchMode ? "default" : "outline"}
          className="text-[10px] h-6 px-2"
          onClick={() => { setBatchMode(!batchMode); if (batchMode) setSelectedIds(new Set()); }}>
          {batchMode ? "Thoát chọn" : "Chọn nhiều"}
        </Button>
      </div>

      {/* ── Stats row ── */}
      <div className="text-[11px] text-muted-foreground mb-2 flex items-center gap-1.5">
        <span className="text-success font-semibold">{checkedInCount ?? filteredDealers.length}</span>
        <span>/</span>
        <span>{totalDealers}</span>
        <span className="ml-1">đang hoạt động</span>
      </div>

      {/* ── Search input ── */}
      <div className="relative mb-2">
        <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Tìm dealer..."
          className="w-full h-7 pl-7 pr-2 text-xs bg-muted/50 border border-border rounded outline-none focus:border-success/50 text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* ── Scrollable roster body ── */}
      <div className="flex-1 space-y-3 overflow-y-auto min-h-0">
        {filteredDealers.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6">
            {searchQuery ? "Không tìm thấy dealer phù hợp." : "Chưa có dealer check-in hôm nay."}
          </div>
        ) : (
          sections.map((sec) => {
            let group = filteredDealers.filter((d) => dealerStatuses[d.id]?.status === sec.key);
            if (!group.length) return null;
            // Sort assigned by urgency — OT first
            if (sec.key === "Đang bàn") {
              group = [...group].sort((a, b) => {
                const aA = assignments.find((x) => x.attendance_id === a.id);
                const bA = assignments.find((x) => x.attendance_id === b.id);
                return urgencyKey(aA) - urgencyKey(bA);
              });
            }
            const Icon = sec.icon;
            const allSelected = group.every((d) => selectedIds.has(d.id));
            return (
              <div key={sec.key}>
                {/* Section header */}
                <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 z-10 pb-0.5">
                  {batchMode && (
                    <input type="checkbox" className="w-3 h-3 accent-[hsl(var(--primary))] cursor-pointer"
                      checked={allSelected}
                      onChange={() => toggleAllInSection(group.map((d) => d.id))} />
                  )}
                  <Icon className={`w-3 h-3 ${sec.color}`} />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{sec.key}</span>
                  <Badge variant="outline" className="text-[9px] ml-auto">{group.length}</Badge>
                </div>

                {/* Compact rows */}
                <div className="space-y-0.5">
                  {group.map((d) => {
                    const dd = d.dealers;
                    const info = dealerStatuses[d.id];
                    const isBusy = processing === d.id;
                    const ready = sec.key === "Sẵn sàng";

                    // Detect OT for this dealer
                    const assignment = assignments.find((a) => a.attendance_id === d.id);
                    const isOt = !!assignment?.overtime_started_at && !assignment?.swing_processed_at;
                    const preAssignStatusLabel = getPreAssignStatusLabel(assignment?.pre_assign_status ?? "none");

                    return (
                      <div key={d.id} className={[
                        "flex items-center gap-2 px-2 py-1.5 rounded transition-all",
                        isOt ? "bg-destructive/20" : "hover:bg-muted/30",
                      ].join(" ")}>
                        {/* Checkbox — batch mode only */}
                        {batchMode && (
                          <input type="checkbox" className="w-3.5 h-3.5 accent-[hsl(var(--primary))] cursor-pointer flex-shrink-0"
                            checked={selectedIds.has(d.id)}
                            onChange={() => toggleId(d.id)} />
                        )}

                        {/* Status dot */}
                        <div className={[
                          "w-1.5 h-1.5 rounded-full flex-shrink-0",
                          isOt ? "bg-destructive" : sec.dot,
                        ].join(" ")} />

                        {/* Name */}
                        <span className={[
                          "text-xs font-medium truncate min-w-0 flex-1",
                          isOt ? "text-destructive" : "text-foreground",
                        ].join(" ")}>
                          {dd?.full_name ?? "—"}
                        </span>

                        {/* Tier (compact) */}
                        <span className={[
                          "text-[9px] font-bold leading-none flex-shrink-0",
                          dd?.tier === "A" ? "text-warning" : dd?.tier === "B" ? "text-[hsl(var(--ds-active))]" : "text-muted-foreground",
                        ].join(" ")}>
                          {dd?.tier ?? "C"}
                        </span>

                        {/* Table badge */}
                        {info?.tableName && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border leading-none flex-shrink-0">
                            {info.tableName}
                          </span>
                        )}
                        {preAssignStatusLabel && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/20 leading-none flex-shrink-0">
                            {preAssignStatusLabel}
                          </span>
                        )}

                        {/* Fatigue dot — computed live from assignment timestamps */}
                        <FatigueDot workedMinutes={liveWorkedMin[d.id] ?? 0} priorityBreakFlag={d.priority_break_flag ?? false} />

                        {/* Timer */}
                        {info && sec.key === "Đang bàn" && (
                          <span className={[
                            "font-mono text-[10px] flex-shrink-0 tabular-nums",
                            isOt ? "text-destructive font-bold" : "text-muted-foreground",
                          ].join(" ")}>
                            <DealerTimer startTime={info.timerStart} />
                          </span>
                        )}

                        {/* Priority break indicator — chỉ hiển thị cho dealer đang làm việc */}
                        <PriorityBreakIndicator
                          priorityBreakFlag={d.priority_break_flag}
                          workedMinutesSinceLastBreak={liveWorkedMin[d.id] ?? 0}
                        />

                        {/* Action: break / meal break / end break */}
                        <div className="flex-shrink-0 flex gap-1">
                          {ready && (() => {
                            const mba = mealBreakAvailability[d.id];
                            const canMealBreak = mba?.available !== false;
                            const nextAt = mba?.nextAvailableAt ? new Date(mba.nextAvailableAt) : null;
                            if (!canMealBreak && nextAt) {
                              const remMin = Math.max(0, Math.floor((nextAt.getTime() - Date.now()) / 60000));
                              const h = Math.floor(remMin / 60);
                              const m = remMin % 60;
                              return (
                                <button disabled className="text-muted-foreground cursor-not-allowed flex items-center gap-0.5" title={`Còn ${h}h${m}m`}>
                                  <Coffee className="w-3 h-3" />
                                  <span className="text-[8px] leading-none">{h > 0 ? `${h}h` : `${m}m`}</span>
                                </button>
                              );
                            }
                            return (
                              <button
                                className="text-warning hover:text-warning transition-colors"
                                title="Nghỉ ăn cơm (+15p)"
                                onClick={() => onMealBreak(d.id)}
                                disabled={isBusy}
                              >
                                <Coffee className="w-3 h-3" />
                              </button>
                            );
                          })()}
                          {ready && (
                            <button className="text-muted-foreground hover:text-foreground transition-colors" title="Gửi nghỉ"
                              onClick={() => onSendToBreak(d.id)} disabled={isBusy}>
                              <Clock className="w-3 h-3" />
                            </button>
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

        {/* Đã check-out section — collapsible, max 3 visible by default */}
        {checkedOutDealers.length > 0 && (
          <CollapsibleSection
            items={checkedOutDealers}
            defaultVisible={3}
            renderItem={(d) => {
              const dd = d.dealers;
              return (
                <div key={d.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/30">
                  <div className="w-5 h-5 rounded bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground flex-shrink-0">
                    {dd?.full_name?.charAt(0) ?? "?"}
                  </div>
                  <span className="text-xs text-muted-foreground truncate flex-1">{dd?.full_name ?? "—"}</span>
                  <span className="text-[9px] text-muted-foreground">{dd?.tier ?? "C"}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {d.check_out_time ? format(new Date(d.check_out_time), "HH:mm") : "?"}
                  </span>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                    onClick={() => onReCheckin(d.dealer_id)} disabled={processing !== null}>
                    Check-in lại
                  </Button>
                </div>
              );
            }}
            header={(
              <div className="flex items-center gap-1.5">
                <UserMinus className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Đã check-out</span>
                <Badge variant="outline" className="text-[9px] ml-auto">{checkedOutDealers.length}</Badge>
              </div>
            )}
          />
        )}
      </div>

      {/* ── Sticky batch action footer ── */}
      {batchMode && selectedIds.size > 0 && (
        <div className="sticky bottom-0 bg-card border-t border-border p-2 mt-2 flex items-center gap-2 rounded-b-lg">
          <span className="text-xs text-muted-foreground flex-1">{selectedIds.size} dealer đã chọn</span>
          <Button size="sm" variant="destructive" className="text-xs h-7"
            onClick={() => { onBatchCheckout([...selectedIds]); setSelectedIds(new Set()); }}>
            <UserMinus className="w-3 h-3 mr-1" /> Check-out
          </Button>
          <Button size="sm" variant="outline" className="text-xs h-7"
            onClick={() => setSelectedIds(new Set())}>
            Hủy
          </Button>
        </div>
      )}

      {/* ── Always-visible footer ── */}
      {!batchMode && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-border flex-wrap">
          {checkedInCount !== undefined && checkedInCount > 0 ? (
            <>
              {/* When dealers are checked in: checkout is primary, check-in is secondary */}
              <Button size="sm" className="flex-[2] text-xs bg-success hover:bg-success text-success-foreground" onClick={onCheckoutOpen}>
                <UserMinus className="w-3 h-3 mr-1" /> Check-out ({checkedInCount})
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onCheckinOpen}>
                <UserPlus className="w-3 h-3 mr-1" /> Check-in
              </Button>
            </>
          ) : (
            <>
              {/* No dealers checked in: check-in is primary */}
              <Button size="sm" className="flex-1 text-xs bg-success hover:bg-success text-success-foreground" onClick={onCheckinOpen}>
                <UserPlus className="w-3 h-3 mr-1" /> Check-in
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={onCheckoutOpen}>
                <UserMinus className="w-3 h-3 mr-1" /> Check-out
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function BreakPoolCard({
  entries,
  loading,
  error,
  processing,
  onEndBreak,
  onSendToBreak,
  onRetry,
}: {
  entries: BreakPoolEntry[];
  loading: boolean;
  error: unknown;
  processing: string | null;
  onEndBreak: (entry: BreakPoolEntry) => void;
  onSendToBreak: (attendanceId: string) => void;
  onRetry: () => void;
}) {
  const nowMs = useLiveClock();
  const summary = useMemo(() => {
    let soon = 0;
    let overdue = 0;
    for (const entry of entries) {
      const state = getBreakVisualState(entry, nowMs, BREAK_SOON_WARNING_MINUTES);
      if (state === "soon") soon += 1;
      if (state === "overdue") overdue += 1;
    }
    return { soon, overdue };
  }, [entries, nowMs]);

  const errorMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : error ? String(error) : "";

  return (
    <Card className="p-3 flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Coffee className="w-4 h-4 text-warning" />
          <span className="font-display text-sm tracking-wider">BREAK POOL</span>
          {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="text-[9px]">{entries.length}</Badge>
          {summary.soon > 0 && (
            <Badge variant="outline" className="text-[9px] border-warning/30 text-warning">
              Sắp hết {summary.soon}
            </Badge>
          )}
          {summary.overdue > 0 && (
            <Badge variant="outline" className="text-[9px] border-destructive/30 text-destructive">
              Quá giờ {summary.overdue}
            </Badge>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="mt-2 flex items-center gap-2 border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate">Lỗi tải break pool: {errorMessage}</span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onRetry}>
            Thử lại
          </Button>
        </div>
      )}

      <div className="mt-2 space-y-1.5 overflow-y-auto min-h-0 max-h-72">
        {loading && entries.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">Đang tải dealer nghỉ...</div>
        ) : entries.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">Chưa có dealer đang nghỉ.</div>
        ) : (
          entries.map((entry) => {
            const isRest = entry.breakType === "rest";
            const visualState = isRest ? "active" : getBreakVisualState(entry, nowMs, BREAK_SOON_WARNING_MINUTES);
            const timing = getBreakTiming(entry, nowMs);
            const isBusy = !isRest && processing === entry.attendanceId;
            const rowClass = cn(
              "flex items-center gap-2 pl-2.5 pr-2 py-1.5 border-l-2 rounded-none transition-colors",
              isRest
                ? "border-[hsl(var(--ds-rest)_/_0.5)] bg-[hsl(var(--ds-rest)_/_0.08)] text-foreground"
                : visualState === "soon"
                  ? "border-warning bg-warning/5 text-warning"
                  : visualState === "overdue"
                    ? "border-destructive bg-destructive/5 text-destructive"
                    : "border-border bg-muted/20 text-foreground",
            );
            // For rest entries, compute seconds remaining
            const remainingSeconds = isRest
              ? Math.max(0, Math.ceil((new Date(entry.expectedReturnAt).getTime() - nowMs) / 1000))
              : 0;
            return (
              <div key={entry.id} className={rowClass}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-semibold truncate">{entry.dealerName}</span>
                    <Badge variant="outline" className="text-[9px] h-5 px-1.5 shrink-0">
                      {isRest ? "Nghỉ" : entry.breakType === "meal" ? "Cơm" : "Break"}
                    </Badge>
                    {isRest && remainingSeconds <= 60 && remainingSeconds > 0 && (
                      <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-success/30 text-success shrink-0">
                        Sắp xong
                      </Badge>
                    )}
                    {!isRest && visualState === "soon" && (
                      <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-warning/30 text-warning shrink-0">
                        Sắp hết giờ
                      </Badge>
                    )}
                    {!isRest && visualState === "overdue" && (
                      <Badge variant="outline" className="text-[9px] h-5 px-1.5 border-destructive/30 text-destructive shrink-0">
                        Quá giờ
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono text-muted-foreground">
                    {isRest ? (
                      <>
                        <span>Nghỉ {timing.elapsedMinutes}p</span>
                        <span>•</span>
                        <span>Còn {remainingSeconds}s</span>
                        <span>•</span>
                        <span>Bắt đầu {format(new Date(entry.breakStartAt), "HH:mm")}</span>
                      </>
                    ) : (
                      <>
                        <span>Đã nghỉ {timing.elapsedMinutes}p</span>
                        <span>•</span>
                        <span>
                          {visualState === "overdue"
                            ? `Quá giờ ${timing.overdueMinutes}p`
                            : `Còn ${timing.remainingMinutes}p`}
                        </span>
                        <span>•</span>
                        <span>Bắt đầu {format(new Date(entry.breakStartAt), "HH:mm")}</span>
                        {entry.tableName && (
                          <>
                            <span>•</span>
                            <span>{entry.tableName}</span>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {isRest ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 text-[10px] shrink-0 border-success/40 text-success hover:bg-success/10"
                    disabled={processing === entry.attendanceId}
                    onClick={() => onSendToBreak(entry.attendanceId)}
                  >
                    Nghỉ thêm
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      "h-9 text-[10px] shrink-0",
                      visualState === "soon"
                        ? "border-warning/40 text-warning hover:bg-warning/10"
                        : visualState === "overdue"
                          ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                          : "",
                    )}
                    disabled={isBusy}
                    onClick={() => onEndBreak(entry)}
                  >
                    {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    <span className="ml-1">Kết thúc nghỉ</span>
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

/* ==============================================================
   TABLE GRID — Center Column
   ============================================================== */
function TableGrid({
  tables, tableAssignmentMap, nextDealerMap, preAssignedMap, scheduleByTableId, timelineByTableId, swingConfigs, tournaments, processing, onAssign, onSendToBreak, onAutoBreak, selectedTour, searchTerm, onCreateTable,
  closeTableConfirmId, onCloseTableClick, onCloseTableConfirm, onCloseTableCancel, closingTable,
  onManualSwing, onForceClose, isAnimating, focusedTableId,
  onSwingTable, swingingAssignmentId,
  dealers, onChangePredicted, onCorrectWrongTable, onOpenRoomReconcile,
}: {
  tables: any[];
  tableAssignmentMap: Record<string, DealerAssignment | null>;
  nextDealerMap: Record<string, NextDealerPrediction> | null;
  preAssignedMap: Record<string, PreAssignedInfo | null>;
  scheduleByTableId?: Record<string, RotationTableSlots>;
  timelineByTableId: Record<string, TableTimeline>;
  swingConfigs: SwingConfig[];
  tournaments: TournamentWithTables[] | undefined;
  processing: string | null;
  onAssign: (tableId: string) => void;
  onSendToBreak: (attendanceId: string) => void;
  onAutoBreak: (attendanceId: string) => void;
  selectedTour: string | null;
  searchTerm?: string;
  onCreateTable: () => void;
  closeTableConfirmId: string | null;
  onCloseTableClick: (tableId: string) => void;
  onCloseTableConfirm: () => void;
  onCloseTableCancel: () => void;
  closingTable: boolean;
  onManualSwing?: (tableId: string) => void;
  onForceClose?: (tableId: string) => void;
  isAnimating?: (tableId: string) => boolean;
  focusedTableId?: string | null;
  onSwingTable: (assignmentId: string) => void;
  swingingAssignmentId: string | null;
  dealers: DealerAttendance[];
  onChangePredicted: (tableId: string) => void;
  onCorrectWrongTable: (tableId: string) => void;
  onOpenRoomReconcile: () => void;
}) {
  const nowMs = useLiveClock();
  // Final-handoff confirmation ("Chốt đổi dealer") — perform_swing itself is unchanged.
  const [confirmSwing, setConfirmSwing] = useState<ConfirmSwingRequest | null>(null);
  const restMinCfg = Math.max(
    10,
    ((swingConfigs.find((c) => (c as any).table_type === "tournament") as any)
      ?.min_inter_swing_rest_minutes as number | undefined) ?? 10,
  );

  // Battle-map status filter (UI Phase 4) — orthogonal to the tour filter.
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");

  const filteredTables = useMemo(() => {
    // Inactive tables sit in the general pool and are not actionable here.
    const active = tables.filter((t) => t.status === "active");
    // "Tổng thể" (All): show EVERY active table; specific tour → shift_id match.
    const scoped = !selectedTour ? active : active.filter((t) => t.shift_id === selectedTour);
    // Quick search (UI polish) — by table name or current dealer name.
    const q = (searchTerm ?? "").trim().toLowerCase();
    const result = !q ? scoped : scoped.filter((t) => {
      const name = String(t.table_name ?? "").toLowerCase();
      const a = tableAssignmentMap[t.id];
      const dealerName = String((a as any)?.dealer_attendance?.dealers?.full_name ?? "").toLowerCase();
      return name.includes(q) || dealerName.includes(q);
    });
    // Sort by table number 1 → 100 (numeric part of "Bàn N").
    return [...result].sort((a, b) =>
      tableNumberOf(a.table_name) - tableNumberOf(b.table_name)
      || String(a.table_name ?? "").localeCompare(String(b.table_name ?? ""), "vi"));
  }, [tables, selectedTour, searchTerm, tableAssignmentMap]);

  // Per-table 7-status (single source — same classifier the card uses) → drives
  // chip counts + the status filter. Recomputed on the live clock so the
  // "Sắp đến giờ" / "Quá hạn" counts stay in sync with the countdowns.
  const tablesWithStatus = useMemo(
    () => filteredTables.map((t) => {
      const a = tableAssignmentMap[t.id];
      const view = deriveTableSwingView(t, a, timelineByTableId[t.id], tournaments, swingConfigs, nowMs);
      const isTour = !!view.tableTournament || t.table_type === "tournament";
      const dealerStatus = deriveDealerTableStatus(view, a, scheduleByTableId?.[t.id], preAssignedMap[t.id], isTour);
      return { table: t, dealerStatus };
    }),
    [filteredTables, tableAssignmentMap, timelineByTableId, tournaments, swingConfigs, nowMs, scheduleByTableId, preAssignedMap],
  );

  const statusCounts = useMemo(() => {
    const c: Record<StatusFilterValue, number> = {
      all: tablesWithStatus.length,
      stable: 0, soon: 0, missing: 0, overdue: 0, break: 0, planned: 0, tour: 0,
    };
    for (const { dealerStatus } of tablesWithStatus) c[dealerStatus] += 1;
    return c;
  }, [tablesWithStatus]);

  const visibleTables = useMemo(
    () => (statusFilter === "all"
      ? tablesWithStatus
      : tablesWithStatus.filter((x) => x.dealerStatus === statusFilter)),
    [tablesWithStatus, statusFilter],
  );

  // Safe handler when a swing timer expires: guards against cross-tab duplicate
  // and re-checks swing_processed_at before calling auto-break
  // Uses in-memory Set instead of localStorage (unavailable in iframe/restricted contexts)
  const processedTimers = useRef(new Set<string>());

  const onTimerExpired = useCallback(async (attendanceId: string, assignmentId: string) => {
    if (processedTimers.current.has(assignmentId)) return;
    processedTimers.current.add(assignmentId);

    try {
      const { data } = await supabase
        .from('dealer_assignments')
        .select('swing_processed_at')
        .eq('id', assignmentId)
        .maybeSingle();

      if (data?.swing_processed_at) return;
      onAutoBreak(attendanceId);
    } catch {
      onAutoBreak(attendanceId);
    }
  }, [onAutoBreak]);

  return (
    <Card className="p-3 h-full">
      <div className="flex items-center gap-2 mb-3">
        <Table2 className="w-4 h-4 text-primary" />
        <span className="font-display text-sm tracking-wider">BẢN ĐỒ CHIẾN TRƯỜNG</span>
        <Badge variant="outline" className="ml-auto text-xs">{filteredTables.length} bàn</Badge>
        {FEATURES.roomReconcileWizard && (
          <Button size="sm" variant="outline"
            className="text-xs h-9 text-warning border-warning/40 hover:bg-warning/10"
            title="Sửa domino nhiều bàn — đối soát thực tế nhiều bàn cùng lúc (có audit)"
            onClick={onOpenRoomReconcile}>
            Sửa domino
          </Button>
        )}
        <Button size="sm" variant="outline" className="text-xs h-9" onClick={onCreateTable}>
          + Thêm bàn
        </Button>
      </div>

      <div className="mb-3">
        <StatusFilterChips counts={statusCounts} value={statusFilter} onChange={setStatusFilter} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 max-h-[62vh] overflow-y-auto pr-0.5">
        {filteredTables.length === 0 ? (
          <div className="col-span-full text-xs text-muted-foreground text-center py-6">
            {selectedTour ? "Chưa có bàn nào trong tour này. Hãy tạo bàn mới hoặc assign dealer." : "Chưa có bàn nào."}
          </div>
        ) : visibleTables.length === 0 ? (
          <div className="col-span-full text-xs text-muted-foreground text-center py-6">
            Không có bàn ở trạng thái này.
          </div>
        ) : (
          visibleTables.map(({ table: t, dealerStatus }) => (
            <SwingTableCard
              key={t.id}
              table={t}
              assignment={tableAssignmentMap[t.id]}
              dealerStatus={dealerStatus}
              timeline={timelineByTableId[t.id]}
              slots={scheduleByTableId?.[t.id]}
              pred={nextDealerMap?.[t.id]}
              preAssigned={preAssignedMap[t.id]}
              tournaments={tournaments}
              swingConfigs={swingConfigs}
              dealers={dealers}
              nowMs={nowMs}
              restMinCfg={restMinCfg}
              processing={processing}
              swingingAssignmentId={swingingAssignmentId}
              isAnimating={isAnimating}
              focused={focusedTableId === t.id}
              closeConfirm={closeTableConfirmId === t.id}
              closingTable={closingTable}
              wrongTableEnabled={FEATURES.wrongTableCorrection}
              onAssign={onAssign}
              onSendToBreak={onSendToBreak}
              onManualSwing={onManualSwing}
              onForceClose={onForceClose}
              onCloseTableClick={onCloseTableClick}
              onCloseTableConfirm={onCloseTableConfirm}
              onCloseTableCancel={onCloseTableCancel}
              onChangePredicted={onChangePredicted}
              onCorrectWrongTable={onCorrectWrongTable}
              onRequestConfirmSwing={setConfirmSwing}
            />
          ))
        )}
      </div>

      <div className="mt-3 border-t border-border pt-2.5">
        <DealerStatusLegend />
      </div>

      {/* Final-handoff confirmation — Chốt đổi dealer / Chốt đổi khẩn cấp */}
      <AlertDialog open={!!confirmSwing} onOpenChange={(o) => { if (!o) setConfirmSwing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmSwing?.isOt ? "Chốt đổi khẩn cấp" : "Chốt đổi dealer"} — {confirmSwing?.tableName}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmSwing?.outName} sẽ ra, {confirmSwing?.inName ?? "dealer do hệ thống chọn"} sẽ vào ngay.
              Đây là handoff cuối cùng — dealer hiện tại được giải phóng và swing log được ghi.
              {confirmSwing?.isOt
                ? " Bàn đang quá hạn: thao tác khẩn cấp, hãy chắc chắn dealer thay đã sẵn sàng."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              className={confirmSwing?.isOt ? "bg-destructive hover:bg-destructive" : undefined}
              onClick={() => {
                if (confirmSwing) onSwingTable(confirmSwing.assignmentId);
                setConfirmSwing(null);
              }}>
              {confirmSwing?.isOt ? "Chốt đổi khẩn cấp" : "Chốt đổi"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* ==============================================================
   AUTO-SCROLL AUDIT LOG HOOK
   ============================================================== */
function CommandCenter({
  auditLogs, onAutoSwing, onMassAssign,
  onExportShift, onExportPayroll, swingAllBusy, massAssignBusy,
  autoSwingEnabled, onToggleAutoSwing,
  clubFilter, clubs, onOpenSwingConfig,
  onOpenSpecialDates, dealers, swingMetrics, tables,
  assignments, tableAssignmentMap, timelineByTableId, nextDealerMap,
  scheduleByTableId,
  onAssign, onSendToBreak, onFocusTable,
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
  onAssign: (tableId: string) => void;
  onSendToBreak: (attendanceId: string) => void;
  dealers: DealerAttendance[];
  swingMetrics: any[];
  tables: any[];
  assignments: DealerAssignment[];
  tableAssignmentMap: Record<string, DealerAssignment | null>;
  timelineByTableId: Record<string, { minutesLeft: number; showNextDealerSoon: boolean; isOverdue: boolean }>;
  nextDealerMap: Record<string, NextDealerPrediction> | null;
  scheduleByTableId?: Record<string, RotationTableSlots>;
  onFocusTable?: (tableId: string) => void;
}) {
  const clubName = useMemo(() => Object.fromEntries(clubs.map((c) => [c.id, c.name])), [clubs]);
  const nowMs = useLiveClock();
  const liveWorkedMin = useMemo(
    () => calculateLiveWorkedMinutes(dealers, assignments, nowMs),
    [dealers, assignments, nowMs]
  );

  // ── Internal dialogs ────────────────────────────────────────────
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [stopSaving, setStopSaving] = useState(false);
  const [fullLogOpen, setFullLogOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [massConfirm, setMassConfirm] = useState(false);

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
    onToggleAutoSwing();
  };

  // ── Computed metrics ────────────────────────────────────────────
  const activeTablesCount = tables?.length ?? 0;
  const assignedTablesCount = useMemo(
    () => assignments.filter((a) => a.status === "assigned").length,
    [assignments],
  );

  // Exceptions count for health badge
  const exceptionsCount = useMemo(() => {
    let count = 0;
    // OT
    for (const a of assignments) {
      if (a.status === "assigned" && a.overtime_started_at) count++;
    }
    // Empty tables
    for (const t of tables ?? []) {
      if (!tableAssignmentMap[t.id]) count++;
    }
    // Break due — use live computed minutes
    for (const d of dealers ?? []) {
      const w = liveWorkedMin[d.id] ?? 0;
      if (w >= 90 || d.priority_break_flag) count++;
    }
    // Missing next dealer
    if (nextDealerMap) {
      for (const t of tables ?? []) {
        const tl = timelineByTableId[t.id];
        if (!tl?.showNextDealerSoon) continue;
        if (!nextDealerMap[t.id]?.nextDealerName) count++;
      }
    }
    return count;
  }, [assignments, tables, dealers, tableAssignmentMap, timelineByTableId, nextDealerMap, liveWorkedMin]);

  const recentLogs = useMemo(() => auditLogs.slice(0, 5), [auditLogs]);

  return (
    <>
      <Card className="p-3 space-y-3">
        {/* ── HEADER ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold tracking-wider">CÔNG CỤ ĐIỀU HÀNH</span>
          </div>
          {/* Stop Swing button — small, tucked in header */}
          <button
            onClick={() => setStopConfirmOpen(true)}
            className="text-[9px] text-destructive/60 hover:text-destructive transition-colors px-1 py-0.5"
            title="Dừng toàn bộ Swing"
          >
            ⏹ Dừng
          </button>
        </div>

        {/* (Alerts moved to the full-width Priority Lane on top — see SwingPanel.) */}

        {/* ── Công cụ điều hành ── */}
        <Collapsible open={toolsOpen} onOpenChange={setToolsOpen}>
          <CollapsibleContent className="space-y-3">
            <hr className="border-border/40" />

            {/* ── OPERATIONS ── */}
            <OperationsCard
              autoSwingEnabled={autoSwingEnabled}
              exceptionsCount={exceptionsCount}
              totalTables={activeTablesCount}
              tablesCovered={assignedTablesCount}
              onToggleAutoSwing={onToggleAutoSwing}
              onAutoSwingAll={onAutoSwing}
              onMassAssign={onMassAssign}
              swingAllBusy={swingAllBusy}
              massAssignBusy={massAssignBusy}
            />

            <hr className="border-border/40" />

            {/* ── RECENT ACTIVITY ── */}
            <RecentActivitySection logs={recentLogs} totalCount={auditLogs.length} onViewAll={() => setFullLogOpen(true)} />

            <hr className="border-border/40" />

            {/* ── QUICK LINKS ── */}
            <QuickLinksCard
              onOpenSwingConfig={onOpenSwingConfig}
              onOpenSpecialDates={onOpenSpecialDates}
              onExportShift={onExportShift}
              onExportPayroll={onExportPayroll}
              onTestTelegram={testTelegram}
              onViewFullAuditLog={() => setFullLogOpen(true)}
            />
          </CollapsibleContent>
        </Collapsible>

        {/* ── Sticky bottom action bar (Gán nhanh + Công cụ) ── */}
        <div className="flex items-center gap-2 border-t border-border/40 pt-3">
          <Button
            onClick={() => setMassConfirm(true)}
            disabled={massAssignBusy}
            className="h-11 flex-1 bg-primary font-medium text-primary-foreground hover:bg-primary/90"
          >
            {massAssignBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Gán nhanh
          </Button>
          <Button variant="outline" onClick={() => setToolsOpen((v) => !v)} className="h-11 px-3 text-xs">
            <Settings className="mr-1.5 h-4 w-4" /> Công cụ
          </Button>
        </div>
      </Card>

      {/* ── Full Audit Log Dialog ── */}
      <Dialog open={fullLogOpen} onOpenChange={setFullLogOpen}>
        <DialogContent className="max-w-lg max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Nhật ký hoạt động</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto space-y-1.5 flex-1">
            {auditLogs.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-4 text-center">Chưa có hoạt động.</div>
            ) : (
              auditLogs.map((log: any) => (
                <div key={log.id} className="text-[11px] text-muted-foreground border-l-2 border-border pl-2 py-0.5">
                  <span className="font-semibold text-foreground">{auditActionLabel(log.action)}</span>
                  {auditLogNames(log.payload) && <span className="ml-1">{auditLogNames(log.payload)}</span>}
                  <span className="block truncate">{new Date(log.created_at).toLocaleString("vi-VN")}</span>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setFullLogOpen(false)}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Gán nhanh confirmation ── */}
      <AlertDialog open={massConfirm} onOpenChange={setMassConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gán nhanh dealer?</AlertDialogTitle>
            <AlertDialogDescription>
              Tự động gán dealer cho các bàn đang trống trong phạm vi CLB đang chọn.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction disabled={massAssignBusy} onClick={onMassAssign}>Gán nhanh</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              className="bg-destructive hover:bg-destructive text-destructive-foreground"
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
  if (timeLeft <= critAt) color = "text-destructive";
  else if (timeLeft <= warnAt) color = "text-warning";

  return (
    <div className={`font-jetbrains tabular-nums text-lg font-bold ${color}`}>
      {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </div>
  );
}

/* ==============================================================
   TIER BADGE
   ============================================================== */

/* ==============================================================
   NEXT DEALER BADGE
   ============================================================== */
/* ==============================================================
   TABLE TYPE BADGE
   ============================================================== */

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
    : poolRatio < 0.8 ? { text: "Thiếu dealer", color: "text-destructive" }
    : poolRatio < 1.1 ? { text: "Bình thường",  color: "text-warning" }
    :                    { text: "Đủ dealer",     color: "text-success" };

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
      min_duration_minutes: Math.max(25, Math.round(base * 0.5)),
      max_duration_minutes: Math.max(Math.round(base * 1.5), base + 5),
    });
    toast.success("Đã áp dụng thông số gợi ý. Nhấn Lưu để ghi vào DB.");
    setSuggestResult(null);
  };

  const suggestBadge = (status: string) => {
    if (status === "understaffed") return { text: "Thiếu dealer", color: "bg-destructive/20 text-destructive" };
    if (status === "overstaffed") return { text: "Đủ dealer", color: "bg-success/20 text-success" };
    return { text: "Bình thường", color: "bg-warning/20 text-warning" };
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <div className="absolute h-full w-1 bg-success rounded"
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
      target_ratio: 1.2, min_duration_minutes: 25, max_duration_minutes: 60,
      rotation_planner_enabled: false, min_inter_swing_rest_minutes: 10,
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
min_duration_minutes: Math.max(5, Math.min((cfg as any).min_duration_minutes ?? 25, Math.max(30, (cfg as any).base_duration_minutes ?? 30) - 1)),
      max_duration_minutes: Math.max((cfg as any).max_duration_minutes ?? 60, Math.max(30, (cfg as any).base_duration_minutes ?? 30) + 5),
           rotation_planner_enabled: (cfg as any).rotation_planner_enabled ?? false,
           min_inter_swing_rest_minutes: Math.max(10, (cfg as any).min_inter_swing_rest_minutes ?? 10),
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
        rotation_planner_enabled: vals.rotation_planner_enabled ?? false,
        min_inter_swing_rest_minutes: Math.max(10, vals.min_inter_swing_rest_minutes ?? 10),
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
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
          <div>
            <Label className="text-[11px]">Nghỉ tối thiểu giữa swing (phút)</Label>
            <Input type="number" min={10} max={30}
              className="h-8 font-mono text-xs"
              value={v.min_inter_swing_rest_minutes ?? 10}
              onChange={(e) => update(type, "min_inter_swing_rest_minutes", Number(e.target.value))} />
            <p className="text-[10px] text-muted-foreground mt-1">Dealer phải nghỉ tối thiểu 10 phút trước khi được xếp ca mới.</p>
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
const AUDIT_ACTION_LABELS: Record<string, string> = {
  assign: "Gán dealer",
  mass_assign: "Gán loạt",
  checkout_dealer: "Check-out dealer",
  table_closed: "Đóng bàn",
  telegram_failed: "Lỗi gửi Telegram",
  tournament_break: "Nghỉ giải đấu",
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/** Display-only: dealer/table names already present in the fetched log row payload. */
function auditLogNames(payload: any): string {
  if (!payload || typeof payload !== "object") return "";
  const parts: string[] = [];
  if (payload.dealer_name) parts.push(String(payload.dealer_name));
  if (payload.table_name) parts.push(`bàn ${payload.table_name}`);
  return parts.join(" · ");
}

function timeAgoVi(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

function RecentActivitySection({ logs, totalCount, onViewAll }: { logs: any[]; totalCount: number; onViewAll: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? logs : logs.slice(0, 3);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Hoạt động gần đây</span>
      </div>
      {logs.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic">Chưa có hoạt động.</div>
      ) : (
        <>
          <div className="space-y-1">
            {visible.map((log: any) => (
              <div key={log.id} className="text-[11px] text-muted-foreground border-l-2 border-border pl-2 py-0.5"
                title={new Date(log.created_at).toLocaleString("vi-VN")}>
                <span className="font-semibold text-foreground">{auditActionLabel(log.action)}</span>
                {auditLogNames(log.payload) && <span className="ml-1">{auditLogNames(log.payload)}</span>}
                <span className="ml-1.5 text-[10px]">{timeAgoVi(log.created_at)}</span>
              </div>
            ))}
          </div>
          {!expanded && logs.length > 3 && (
            <button
              onClick={() => setExpanded(true)}
              className="text-[10px] text-muted-foreground hover:text-foreground w-full text-left"
            >
              Xem thêm…
            </button>
          )}
          {totalCount > logs.length && (
            <button
              onClick={onViewAll}
              className="text-[10px] text-primary hover:text-primary/80 font-semibold w-full text-left pt-0.5"
            >
              Xem toàn bộ &rarr;
            </button>
          )}
        </>
      )}
    </div>
  );
}

