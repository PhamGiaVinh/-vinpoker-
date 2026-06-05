import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { exportToExcel, type ExcelColumn } from "@/lib/exportExcel";
import {
  useDealerPayroll, type DealerPayrollRow,
  savePayroll, addPayrollAdjustment, loadPayrollAdjustments, getSavedPayroll, deletePayrollAdjustment,
  submitPayroll, approvePayroll, lockPayroll, rejectPayroll, resubmitPayroll,
  getPayrollAuditLog,
  type PayrollAdjustmentRow, type SavedPayrollRecord,
} from "@/hooks/useDealerPayroll";
import {
  Users, RefreshCw, Download, Calculator, Save, Plus, Trash2, Loader2, Moon, FileText,
} from "lucide-react";

type ClubRow = { id: string; name: string };
type AdjType = "BONUS" | "PENALTY" | "DEDUCTION" | "ADVANCE" | "OTHER" | "TIPS";

const ADJ_TYPE_LABELS: Record<AdjType, string> = {
  BONUS: "Thưởng",
  PENALTY: "Phạt",
  DEDUCTION: "Khấu trừ",
  ADVANCE: "Tạm ứng",
  OTHER: "Khác",
  TIPS: "Tips",
};

const ADJ_TYPE_COLORS: Record<AdjType, string> = {
  BONUS: "border-emerald-500 text-emerald-400",
  PENALTY: "border-red-500 text-red-400",
  DEDUCTION: "border-orange-500 text-orange-400",
  ADVANCE: "border-blue-500 text-blue-400",
  OTHER: "border-zinc-500 text-zinc-400",
  TIPS: "border-yellow-500 text-yellow-400",
};

// ── Column config (single source of truth for table + export + PDF) ──────────

type HideBelow = "md" | "lg" | "xl";

type ColumnKey =
  | "full_name"
  | "employment_type"
  | "total_shifts"
  | "total_hours"
  | "regular_hours"
  | "ot_hours"
  | "base_pay"
  | "regular_pay"
  | "ot_pay"
  | "gross_pay"
  | "tips"
  | "bhxh"
  | "bhyt"
  | "bhtn"
  | "pit"
  | "net_after_tax"
  | "adjustments"
  | "net_pay"
  | "actions";

interface ColumnDef {
  key: ColumnKey;
  label: string;
  hideBelow?: HideBelow;
  export: boolean;
}

const COLUMNS: readonly ColumnDef[] = [
  { key: "full_name",       label: "Tên",        export: true },
  { key: "employment_type", label: "Loại",       export: true },
  { key: "total_shifts",    label: "Ca",         export: true },
  { key: "total_hours",     label: "Tổng giờ",   export: true },
  { key: "regular_hours",   label: "Giờ chuẩn",  export: true },
  { key: "ot_hours",        label: "OT",         export: true },
  { key: "base_pay",        label: "Lương CB",   export: true },
  { key: "regular_pay",     label: "Thường",     hideBelow: "md", export: true },
  { key: "ot_pay",          label: "OT pay",     export: true },
  { key: "gross_pay",       label: "Gộp",        export: true },
  { key: "tips",            label: "Tips",       hideBelow: "lg", export: true },
  { key: "bhxh",            label: "BHXH",       hideBelow: "lg", export: true },
  { key: "bhyt",            label: "BHYT",       hideBelow: "lg", export: true },
  { key: "bhtn",            label: "BHTN",       hideBelow: "lg", export: true },
  { key: "pit",             label: "PIT",        hideBelow: "xl", export: true },
  { key: "net_after_tax",   label: "Sau thuế",   hideBelow: "lg", export: true },
  { key: "adjustments",     label: "Điều chỉnh", export: true },
  { key: "net_pay",         label: "Thực lãnh",  export: true },
  { key: "actions",         label: "",           export: false },
] as const;

// ── Filter types & pure helpers (file level) ─────────────────────────────────

type FilterKey = "all" | "full_time" | "part_time" | "has_adjustments" | "high_ot";

const FILTERS: readonly { key: FilterKey; label: string; danger?: boolean }[] = [
  { key: "all",             label: "Tất cả" },
  { key: "full_time",       label: "FT" },
  { key: "part_time",       label: "PT" },
  { key: "has_adjustments", label: "Có điều chỉnh" },
  { key: "high_ot",         label: "OT nhiều", danger: true },
] as const;

function passesFilter(
  row: DealerPayrollRow,
  filter: FilterKey,
  adjustmentsMap: Record<string, PayrollAdjustmentRow[]>
): boolean {
  if (filter === "has_adjustments") return (adjustmentsMap[row.dealer_id]?.length ?? 0) > 0;
  if (filter === "high_ot") return row.ot_hours >= 20;
  // 'all', 'full_time', 'part_time' handled by section split
  return true;
}

function matchesSearch(row: DealerPayrollRow, query: string): boolean {
  if (!query) return true;
  return row.full_name.toLowerCase().includes(query.toLowerCase());
}

// ── Excel export value accessor ──────────────────────────────────────────────

function getExportValue(key: ColumnKey): (r: DealerPayrollRow) => string | number | null {
  switch (key) {
    case "full_name":       return (r) => r.full_name;
    case "employment_type": return (r) => r.employment_type === "full_time" ? "FT" : "PT";
    case "total_shifts":    return (r) => r.total_shifts;
    case "total_hours":     return (r) => r.total_hours ? Number(r.total_hours.toFixed(1)) : 0;
    case "regular_hours":   return (r) => r.regular_hours ? Number(r.regular_hours.toFixed(1)) : 0;
    case "ot_hours":        return (r) => r.ot_hours ? Number(r.ot_hours.toFixed(1)) : 0;
    case "base_pay":        return (r) => r.base_salary_vnd;
    case "regular_pay":     return (r) => r.regular_pay_vnd;
    case "ot_pay":          return (r) => r.ot_pay_vnd;
    case "gross_pay":       return (r) => r.gross_pay_vnd;
    case "tips":            return (r) => r.tips_amount_vnd;
    case "bhxh":            return (r) => r.bhxh_deduction_vnd;
    case "bhyt":            return (r) => r.bhyt_deduction_vnd;
    case "bhtn":            return (r) => r.bhtn_deduction_vnd;
    case "pit":             return (r) => r.pit_deduction_vnd;
    case "net_after_tax":   return (r) => r.net_pay_after_tax_vnd;
    case "adjustments":     return (r) => r.total_adjustments_vnd;
    case "net_pay":         return (r) => r.net_pay_vnd;
    case "actions":         return () => null;
    default: { const _: never = key; return () => null; }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatVNDShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}tr`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString("vi-VN");
}

function formatHours(h: number): string {
  if (h === 0) return "—";
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  if (mins === 0) return `${hours}h`;
  return `${hours}h${mins < 10 ? "0" : ""}${mins}ph`;
}

// ── MetricCard (used in summary strip) ───────────────────────────────────────

type MetricVariant = "default" | "success" | "danger" | "warning";

function MetricCard({ label, value, sub, variant = "default" }: {
  label: string;
  value: ReactNode;
  sub?: string;
  variant?: MetricVariant;
}) {
  const variantStyles: Record<MetricVariant, string> = {
    default: "text-zinc-100",
    success: "text-emerald-400",
    danger: "text-red-400",
    warning: "text-amber-400",
  };
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 flex flex-col gap-1 min-w-0">
      <span className="text-[11px] text-zinc-500 uppercase tracking-wider truncate">{label}</span>
      <span className={`text-base font-semibold ${variantStyles[variant]} truncate`}>{value}</span>
      {sub && <span className="text-[10px] text-zinc-500 truncate">{sub}</span>}
    </div>
  );
}

function getMonthYearOptions(): { value: string; label: string; start: string; end: string; year: number; month: number }[] {
  const options: { value: string; label: string; start: string; end: string; year: number; month: number }[] = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const pad = (n: number) => String(n).padStart(2, "0");
    const start = `${year}-${pad(month)}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${pad(month)}-${lastDay}`;
    const label = `Tháng ${month}/${year}`;
    const value = `${year}-${pad(month)}`;
    options.push({ value, label, start, end, year, month });
  }
  return options;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface DealerPayrollTabProps {
  clubIds: string[];
  clubs: ClubRow[];
}

export default function DealerPayrollTab({ clubIds, clubs }: DealerPayrollTabProps) {
  const { user } = useAuth();
  const monthOptions = useMemo(() => getMonthYearOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.value ?? "");
  const currentRange = useMemo(() => monthOptions.find((o) => o.value === selectedMonth), [monthOptions, selectedMonth]);
  const [clubFilter, setClubFilter] = useState<string>(clubIds.length === 1 ? clubIds[0] : "");

  const { data: payrollRows, period, loading, error, fetchPayroll } = useDealerPayroll(clubIds);
  const activeClubId = clubFilter || clubIds[0] || "";

  // ── Saved payroll state ──────────────────────────────────────────────────
  const [savedPeriodId, setSavedPeriodId] = useState<string | null>(null);
  const [payrollStatus, setPayrollStatus] = useState<string | null>(null);
  const [savedRecords, setSavedRecords] = useState<Record<string, SavedPayrollRecord>>({});
  const [adjustments, setAdjustments] = useState<Record<string, PayrollAdjustmentRow[]>>({});
  const [saving, setSaving] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectedBy, setRejectedBy] = useState<string | null>(null);
  const [rejectedAt, setRejectedAt] = useState<string | null>(null);
  const [storedRejectionReason, setStoredRejectionReason] = useState<string | null>(null);

  // Audit log state
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [auditLog, setAuditLog] = useState<Array<{
    id: string;
    table_name: string;
    record_id: string;
    action: string;
    old_values: any;
    new_values: any;
    changed_by: string | null;
    changed_at: string;
  }>>([]);

  // PDF export loading state
  const [exporting, setExporting] = useState<string | null>(null);

  // Adjustment dialog state
  const [adjDialogOpen, setAdjDialogOpen] = useState(false);
  const [adjustingDealerId, setAdjustingDealerId] = useState<string | null>(null);
  const [adjType, setAdjType] = useState<AdjType>("BONUS");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjSaving, setAdjSaving] = useState(false);

  // Filter + search state
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ── Fetch payroll & check saved ──────────────────────────────────────────

  const refreshAll = useCallback(async () => {
    if (!activeClubId || !currentRange) return;
    await fetchPayroll(activeClubId, currentRange.start, currentRange.end);
    const { periodId, status, records, rejectedBy: rBy, rejectedAt: rAt, rejectionReason: rReason } =
      await getSavedPayroll(activeClubId, currentRange.year, currentRange.month);
    setSavedPeriodId(periodId);
    setPayrollStatus(status);
    setRejectedBy(rBy);
    setRejectedAt(rAt);
    setStoredRejectionReason(rReason);
    const recordMap: Record<string, SavedPayrollRecord> = {};
    for (const r of records) { recordMap[r.dealer_id] = r; }
    setSavedRecords(recordMap);
    if (periodId) {
      const adjMap = await loadPayrollAdjustments(periodId);
      setAdjustments(adjMap);
    } else {
      setAdjustments({});
    }
  }, [activeClubId, currentRange, fetchPayroll]);

  useEffect(() => {
    if (!activeClubId || !currentRange) return;
    refreshAll();
  }, [activeClubId, currentRange, refreshAll]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const ftDealers = useMemo(() => payrollRows.filter((d) => d.employment_type === "full_time"), [payrollRows]);
  const ptDealers = useMemo(() => payrollRows.filter((d) => d.employment_type === "part_time"), [payrollRows]);

  const filteredFt = useMemo(() =>
    ftDealers.filter((r) => passesFilter(r, activeFilter, adjustments))
             .filter((r) => matchesSearch(r, searchQuery)),
    [ftDealers, activeFilter, adjustments, searchQuery]);

  const filteredPt = useMemo(() =>
    ptDealers.filter((r) => passesFilter(r, activeFilter, adjustments))
             .filter((r) => matchesSearch(r, searchQuery)),
    [ptDealers, activeFilter, adjustments, searchQuery]);

  const highOtCount = useMemo(
    () => payrollRows.filter((r) => r.ot_hours >= 20).length,
    [payrollRows]
  );

  const totals = useMemo(() => {
    const sum = (key: keyof DealerPayrollRow) => payrollRows.reduce((s, d) => s + (d[key] as number), 0);
    return {
      totalGross: sum("gross_pay_vnd"),
      totalBase: sum("base_salary_vnd"),
      totalOt: sum("ot_pay_vnd"),
      totalNet: sum("net_pay_vnd"),
      totalAdjust: sum("total_adjustments_vnd"),
      totalHours: sum("total_hours"),
      totalShifts: sum("total_shifts"),
      totalTips: sum("tips_amount_vnd"),
      totalBhxh: sum("bhxh_deduction_vnd"),
      totalBhyt: sum("bhyt_deduction_vnd"),
      totalBhtn: sum("bhtn_deduction_vnd"),
      totalPit: sum("pit_deduction_vnd"),
      totalNetAfterTax: sum("net_pay_after_tax_vnd"),
    };
  }, [payrollRows]);

  // ── Save payroll ──────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!user || !activeClubId || !currentRange || !payrollRows.length) return;
    setSaving(true);
    try {
      const result = await savePayroll(activeClubId, currentRange.year, currentRange.month, payrollRows, user.id);
      setSavedPeriodId(result.periodId);
      setPayrollStatus("draft");
      toast.success(`Đã lưu bảng lương — ${result.savedCount} dealer`);
      await refreshAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu bảng lương");
    } finally {
      setSaving(false);
    }
  }, [user, activeClubId, currentRange, payrollRows, refreshAll]);

  // ── Status helpers ──────────────────────────────────────────────────────────

  const isLocked = payrollStatus === "locked";
  const isDraft = payrollStatus === "draft" || payrollStatus === null;
  const isSubmitted = payrollStatus === "submitted";
  const isApproved = payrollStatus === "approved";

  // ── Submit / Approve / Lock ─────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!user || !savedPeriodId) return;
    try {
      await submitPayroll(savedPeriodId, user.id);
      setPayrollStatus("submitted");
      toast.success("Đã gửi duyệt");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi gửi duyệt");
    }
  }, [user, savedPeriodId]);

  const handleApprove = useCallback(async () => {
    if (!user || !savedPeriodId) return;
    try {
      await approvePayroll(savedPeriodId, user.id);
      setPayrollStatus("approved");
      toast.success("Đã phê duyệt");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi phê duyệt");
    }
  }, [user, savedPeriodId]);

  const handleLock = useCallback(async () => {
    if (!user || !savedPeriodId) return;
    try {
      await lockPayroll(savedPeriodId, user.id);
      setPayrollStatus("locked");
      toast.success("Đã khoá sổ");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi khoá sổ");
    }
  }, [user, savedPeriodId]);

  const handleReject = useCallback(async (reason: string) => {
    if (!user || !savedPeriodId) return;
    if (!reason.trim()) {
      toast.error("Vui lòng nhập lý do từ chối");
      return;
    }
    try {
      await rejectPayroll(savedPeriodId, user.id, reason);
      setPayrollStatus("rejected");
      setRejectedBy(user.id);
      setRejectedAt(new Date().toISOString());
      setStoredRejectionReason(reason);
      setRejectionReason("");
      toast.success("Đã từ chối bảng lương");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi từ chối");
    }
  }, [user, savedPeriodId]);

  const handleResubmit = useCallback(async () => {
    if (!user || !savedPeriodId) return;
    try {
      await resubmitPayroll(savedPeriodId, user.id);
      setPayrollStatus("draft");
      setRejectedBy(null);
      setRejectedAt(null);
      setStoredRejectionReason(null);
      toast.success("Đã chuyển về nháp");
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi chuyển về nháp");
    }
  }, [user, savedPeriodId]);

  const openAuditLog = useCallback(async () => {
    if (!savedPeriodId) return;
    try {
      const data = await getPayrollAuditLog(savedPeriodId);
      setAuditLog(data);
      setAuditLogOpen(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi tải audit log");
    }
  }, [savedPeriodId]);

  const exportSinglePdf = useCallback(async (row: DealerPayrollRow) => {
    setExporting(row.dealer_id);
    try {
      const { exportPayrollPdf } = await import("@/lib/exportPayrollPdf");
      const clubName = clubs.find((c) => c.id === activeClubId)?.name ?? "club";
      const monthLabel = currentRange?.label ?? selectedMonth;
      await exportPayrollPdf([row], clubName, monthLabel, row.dealer_id);
      toast.success(`Đã xuất PDF phiếu lương ${row.full_name}`);
    } catch (e: any) {
      // Fallback to print
      try {
        window.print();
        toast.info("Đã mở print dialog (fallback)");
      } catch {
        toast.error(e?.message ?? "Lỗi xuất PDF");
      }
    } finally {
      setExporting(null);
    }
  }, [clubs, activeClubId, currentRange, selectedMonth]);

  // ── Add adjustment ────────────────────────────────────────────────────────

  const openAdjustDialog = useCallback((dealerId: string) => {
    setAdjustingDealerId(dealerId);
    setAdjType("BONUS");
    setAdjAmount("");
    setAdjReason("");
    setAdjDialogOpen(true);
  }, []);

  const handleAddAdjustment = useCallback(async () => {
    if (!adjustingDealerId || !user || !savedPeriodId) return;
    const record = savedRecords[adjustingDealerId];
    if (!record) {
      toast.error("Vui lòng lưu bảng lương trước khi thêm điều chỉnh");
      return;
    }
    const amount = parseInt(adjAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Số tiền không hợp lệ");
      return;
    }
    setAdjSaving(true);
    try {
      await addPayrollAdjustment(record.id, adjType, amount, adjReason || adjType, user.id);
      toast.success("Đã thêm điều chỉnh");
      setAdjDialogOpen(false);
      await refreshAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi thêm điều chỉnh");
    } finally {
      setAdjSaving(false);
    }
  }, [adjustingDealerId, user, savedPeriodId, savedRecords, adjType, adjAmount, adjReason, refreshAll]);

  // ── Delete adjustment ─────────────────────────────────────────────────────

  const handleDeleteAdjustment = useCallback(async (adjId: string) => {
    try {
      await deletePayrollAdjustment(adjId);
      toast.success("Đã xóa điều chỉnh");
      await refreshAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi xóa điều chỉnh");
    }
  }, [refreshAll]);

  // ── Export ─────────────────────────────────────────────────────────────────

  const doExport = useCallback(() => {
    if (!payrollRows.length) return;
    const clubName = clubs.find((c) => c.id === activeClubId)?.name ?? "club";
    const monthLabel = currentRange?.label ?? selectedMonth;
    const allRows = [...ftDealers, ...ptDealers];
    const exportColumns: ExcelColumn<DealerPayrollRow>[] = COLUMNS
      .filter((c) => c.export)
      .map((c) => {
        const headerSuffix = c.key === "base_pay" || c.key === "regular_pay" ||
                             c.key === "ot_pay" || c.key === "gross_pay" ||
                             c.key === "tips" || c.key === "bhxh" ||
                             c.key === "bhyt" || c.key === "bhtn" ||
                             c.key === "pit" || c.key === "net_after_tax" ||
                             c.key === "adjustments" || c.key === "net_pay"
                             ? " (VND)" : "";
        return { header: c.label + headerSuffix, get: getExportValue(c.key) };
      });
    exportToExcel(allRows, exportColumns, `luong-${clubName}-${monthLabel}`, "Bảng lương");
    toast.success(`Đã tải bảng lương ${monthLabel}`);
  }, [payrollRows, ftDealers, ptDealers, clubs, activeClubId, currentRange, selectedMonth]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderCell = (col: typeof COLUMNS[number], r: DealerPayrollRow): ReactNode => {
    const isFullTime = r.employment_type === "full_time";
    const baseRight = "text-right font-mono text-xs";

    switch (col.key) {
      case "full_name":
        return (
          <div className="font-medium text-white text-sm">
            <div className="flex items-center gap-1">
              {r.full_name}
              {!isLocked && savedRecords[r.dealer_id] && (
                <button
                  className="text-[10px] text-zinc-400 hover:text-emerald-400 ml-1"
                  onClick={() => openAdjustDialog(r.dealer_id)}
                  title="Thêm điều chỉnh"
                >
                  <Plus className="w-3 h-3" />
                </button>
              )}
            </div>
            {(adjustments[r.dealer_id]?.length ?? 0) > 0 && (
              <div className="mt-1 space-y-0.5">
                {(adjustments[r.dealer_id] ?? []).map((a) => (
                  <div key={a.id} className="flex items-center gap-1 text-[10px]">
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 ${ADJ_TYPE_COLORS[a.adjustment_type as AdjType] ?? ""}`}>
                      {ADJ_TYPE_LABELS[a.adjustment_type as AdjType] ?? a.adjustment_type}
                    </Badge>
                    <span className={(a.adjustment_type === "BONUS" || a.adjustment_type === "OTHER") ? "text-emerald-400" : "text-red-400"}>
                      {(a.adjustment_type === "BONUS" || a.adjustment_type === "OTHER" ? "+" : "-")}{Number(a.amount_vnd).toLocaleString("vi-VN")}
                    </span>
                    <span className="text-zinc-500">{a.reason}</span>
                    {!isLocked && (
                      <button
                        className="text-zinc-600 hover:text-red-400 ml-0.5"
                        onClick={() => handleDeleteAdjustment(a.id)}
                        title="Xóa"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      case "employment_type":
        return (
          <Badge
            variant="outline"
            className={`text-[10px] ${isFullTime ? "border-emerald-500 text-emerald-400" : "border-amber-500 text-amber-400"}`}
          >
            {isFullTime ? "FT" : "PT"}
          </Badge>
        );
      case "total_shifts": {
        const hasOvernight = r.shifts.some((s) => s.is_overnight);
        return (
          <div className={`${baseRight.replace("text-right", "text-center")} text-zinc-300`}>
            <div className="flex items-center justify-center gap-1">
              {r.total_shifts || "—"}
              {hasOvernight && <Moon className="w-3 h-3 text-indigo-400" title="Có ca qua đêm" />}
            </div>
          </div>
        );
      }
      case "total_hours":     return <span className={`${baseRight} text-zinc-300`}>{formatHours(r.total_hours)}</span>;
      case "regular_hours":   return <span className={`${baseRight} text-zinc-300`}>{formatHours(r.regular_hours)}</span>;
      case "ot_hours":        return <span className={`${baseRight} ${r.ot_hours > 0 ? "text-red-400 font-semibold" : "text-zinc-500"}`}>{r.ot_hours > 0 ? formatHours(r.ot_hours) : "—"}</span>;
      case "base_pay":
        return (
          <span className={`${baseRight} text-zinc-300`}>
            {isFullTime
              ? r.monthly_salary_vnd ? formatVNDShort(r.monthly_salary_vnd) : "—"
              : r.hourly_rate_vnd ? `${(r.hourly_rate_vnd / 1000).toFixed(0)}K/h` : "—"}
          </span>
        );
      case "regular_pay":     return <span className={`${baseRight} text-zinc-300`}>{formatVND(r.regular_pay_vnd)}</span>;
      case "ot_pay":          return <span className={`${baseRight} ${r.ot_pay_vnd > 0 ? "text-red-400" : "text-zinc-500"}`}>{r.ot_pay_vnd > 0 ? formatVND(r.ot_pay_vnd) : "—"}</span>;
      case "gross_pay":       return <span className={`${baseRight} font-semibold text-emerald-400`}>{formatVND(r.gross_pay_vnd)}</span>;
      case "tips":            return <span className={`${baseRight} text-zinc-500`}>{r.tips_amount_vnd > 0 ? formatVND(r.tips_amount_vnd) : "—"}</span>;
      case "bhxh":            return <span className={`${baseRight} ${isFullTime ? "text-zinc-300" : "text-zinc-600"}`}>{isFullTime && r.bhxh_deduction_vnd > 0 ? formatVND(r.bhxh_deduction_vnd) : "—"}</span>;
      case "bhyt":            return <span className={`${baseRight} ${isFullTime ? "text-zinc-300" : "text-zinc-600"}`}>{isFullTime && r.bhyt_deduction_vnd > 0 ? formatVND(r.bhyt_deduction_vnd) : "—"}</span>;
      case "bhtn":            return <span className={`${baseRight} ${isFullTime ? "text-zinc-300" : "text-zinc-600"}`}>{isFullTime && r.bhtn_deduction_vnd > 0 ? formatVND(r.bhtn_deduction_vnd) : "—"}</span>;
      case "pit":             return <span className={`${baseRight} text-zinc-500`}>{r.pit_deduction_vnd > 0 ? formatVND(r.pit_deduction_vnd) : "—"}</span>;
      case "net_after_tax":   return <span className={`${baseRight} font-semibold text-emerald-400`}>{formatVND(r.net_pay_after_tax_vnd)}</span>;
      case "adjustments":
        return (
          <span className={`${baseRight} ${r.total_adjustments_vnd > 0 ? "text-emerald-400" : r.total_adjustments_vnd < 0 ? "text-red-400" : "text-zinc-500"}`}>
            {r.total_adjustments_vnd !== 0 ? formatVND(r.total_adjustments_vnd) : "—"}
          </span>
        );
      case "net_pay":         return <span className={`${baseRight} font-semibold`}>{formatVND(r.net_pay_vnd)}</span>;
      case "actions":
        return (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => exportSinglePdf(r)}
              disabled={exporting === r.dealer_id}
              className="p-1 rounded text-zinc-500 hover:text-emerald-400 disabled:opacity-50"
              title="Xuất PDF"
            >
              {exporting === r.dealer_id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileText className="w-3.5 h-3.5" />
              )}
            </button>
            {!isLocked && savedRecords[r.dealer_id] && (
              <button
                onClick={() => openAdjustDialog(r.dealer_id)}
                className="p-1 rounded text-zinc-500 hover:text-emerald-400"
                title="Điều chỉnh"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      default: { const _: never = col.key; return null; }
    }
  };

  const renderRow = (r: DealerPayrollRow) => (
    <TableRow key={r.dealer_id} className="hover:bg-zinc-800/50">
      {COLUMNS.map((col) => {
        const cellClass = col.hideBelow ? `hidden ${col.hideBelow}:table-cell` : "";
        return (
          <TableCell key={col.key} className={cellClass}>
            {renderCell(col, r)}
          </TableCell>
        );
      })}
    </TableRow>
  );

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {clubs.length > 1 && (
          <Select value={clubFilter} onValueChange={(v) => setClubFilter(v)}>
            <SelectTrigger className="w-48 h-8 text-xs">
              <SelectValue placeholder="Chọn CLB" />
            </SelectTrigger>
            <SelectContent>
              {clubs.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={refreshAll}
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Làm mới
        </Button>

        {payrollRows.length > 0 && (
          <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white" onClick={doExport}>
            <Download className="w-3.5 h-3.5 mr-1" />
            Xuất Excel
          </Button>
        )}

        {/* Save button (always in toolbar) */}
        {payrollRows.length > 0 && !savedPeriodId && (
          <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
            Lưu bảng lương
          </Button>
        )}

        {payrollStatus === "draft" && savedPeriodId && (
          <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
            Lưu lại
          </Button>
        )}

        <div className="flex-1" />

        <div className="text-xs text-zinc-500">
          {payrollRows.length > 0 && (
            <span>{payrollRows.length} dealer · {period.start} → {period.end}</span>
          )}
        </div>
      </div>

      {payrollRows.length > 0 && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            <MetricCard label="Tổng dealer" value={payrollRows.length} sub={`FT: ${ftDealers.length} · PT: ${ptDealers.length}`} />
            <MetricCard label="Tổng gross" value={formatVNDShort(totals.totalGross)} sub="Lương cơ bản" />
            <MetricCard label="Tổng OT" value={formatHours(totals.totalOt)} sub={`${highOtCount} người > 20h`} variant={totals.totalOt > 0 ? "danger" : "default"} />
            <MetricCard label="Điều chỉnh" value={formatVND(totals.totalAdjust)} sub="Tips · phạt" />
            <MetricCard label="Thực lãnh" value={formatVNDShort(totals.totalNet)} sub="Sau khấu trừ" variant="success" />
          </div>

          {/* Filter pills + search */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1.5 flex-wrap">
              {FILTERS.map((f) => {
                const count = f.key === "all"
                  ? payrollRows.length
                  : f.key === "full_time"
                    ? ftDealers.length
                    : f.key === "part_time"
                      ? ptDealers.length
                      : payrollRows.filter((r) => passesFilter(r, f.key, adjustments)).length;
                const isActive = activeFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setActiveFilter(f.key)}
                    className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${
                      isActive
                        ? f.danger
                          ? "bg-red-950 border-red-500 text-red-300"
                          : "bg-zinc-100 border-zinc-100 text-zinc-900 font-medium"
                        : f.danger
                          ? "border-red-900 text-red-400 hover:bg-red-950"
                          : "border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    }`}
                  >
                    {f.label}
                    <span className={`text-[10px] rounded-full px-1.5 ${isActive ? "bg-zinc-700/30" : "bg-zinc-800"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex-1" />
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">⌕</span>
              <input
                type="text"
                placeholder="Tìm tên dealer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 w-48 bg-zinc-900 border border-zinc-700 rounded-md pl-7 pr-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Empty state when both sections filtered out */}
          {filteredFt.length === 0 && filteredPt.length === 0 && (
            <div className="text-center text-zinc-500 text-sm py-8">
              Không tìm thấy dealer phù hợp
              {searchQuery && <span className="block text-xs mt-1">Từ khoá: "{searchQuery}"</span>}
            </div>
          )}
        </>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* No data */}
      {!loading && !error && payrollRows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
          <Calculator className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">Chưa có dữ liệu lương cho tháng này</p>
          <p className="text-xs mt-1">Chọn tháng và CLB, rồi nhấn "Làm mới"</p>
        </div>
      )}

      {/* Payroll tables */}
      {!loading && !error && payrollRows.length > 0 && (
        <ScrollArea className="flex-1">
          {/* FT Section */}
          {filteredFt.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-emerald-600 text-white text-[10px]">Full-time</Badge>
                <span className="text-xs text-zinc-400">{filteredFt.length} dealer</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800">
                    {COLUMNS.map((col) => (
                      <TableHead
                        key={col.key}
                        className={`text-zinc-400 text-xs ${col.key === "full_name" ? "" : "text-right"} ${col.key === "employment_type" ? "w-12 text-center" : ""} ${col.key === "total_shifts" ? "w-10 text-center" : ""} ${col.hideBelow ? `hidden ${col.hideBelow}:table-cell` : ""}`}
                      >
                        {col.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFt.map(renderRow)}
                  <TableRow className="border-t-2 border-emerald-600/30 bg-emerald-600/5">
                    <TableCell className="font-bold text-emerald-400 text-xs" colSpan={3}>FT subtotal</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatHours(ftDealers.reduce((s, d) => s + d.total_hours, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatHours(ftDealers.reduce((s, d) => s + d.regular_hours, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-red-400">
                      {(() => { const total = ftDealers.reduce((s, d) => s + d.ot_hours, 0); return total > 0 ? formatHours(total) : "—"; })()}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatVND(ftDealers.reduce((s, d) => s + d.regular_pay_vnd, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-red-400">
                      {(() => { const t = ftDealers.reduce((s, d) => s + d.ot_pay_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-emerald-400">{formatVND(ftDealers.reduce((s, d) => s + d.gross_pay_vnd, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {(() => { const t = ftDealers.reduce((s, d) => s + d.tips_amount_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-zinc-400">
                      {(() => { const t = ftDealers.reduce((s, d) => s + d.bhxh_deduction_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-zinc-400">
                      {(() => { const t = ftDealers.reduce((s, d) => s + d.bhyt_deduction_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-zinc-400">
                      {(() => { const t = ftDealers.reduce((s, d) => s + d.bhtn_deduction_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-zinc-400">
                      {(() => { const t = ftDealers.reduce((s, d) => s + d.pit_deduction_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-emerald-400">{formatVND(ftDealers.reduce((s, d) => s + d.net_pay_after_tax_vnd, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {(() => { const t = ftDealers.reduce((s, d) => s + d.total_adjustments_vnd, 0); return t !== 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* PT Section */}
          {filteredPt.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-amber-600 text-white text-[10px]">Part-time</Badge>
                <span className="text-xs text-zinc-400">{filteredPt.length} dealer</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800">
                    {COLUMNS.map((col) => (
                      <TableHead
                        key={col.key}
                        className={`text-zinc-400 text-xs ${col.key === "full_name" ? "" : "text-right"} ${col.key === "employment_type" ? "w-12 text-center" : ""} ${col.key === "total_shifts" ? "w-10 text-center" : ""} ${col.hideBelow ? `hidden ${col.hideBelow}:table-cell` : ""}`}
                      >
                        {col.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPt.map(renderRow)}
                  <TableRow className="border-t-2 border-amber-600/30 bg-amber-600/5">
                    <TableCell className="font-bold text-amber-400 text-xs" colSpan={3}>PT subtotal</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatHours(ptDealers.reduce((s, d) => s + d.total_hours, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatHours(ptDealers.reduce((s, d) => s + d.regular_hours, 0))}</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatVND(ptDealers.reduce((s, d) => s + d.regular_pay_vnd, 0))}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-semibold text-emerald-400">{formatVND(ptDealers.reduce((s, d) => s + d.gross_pay_vnd, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {(() => { const t = ptDealers.reduce((s, d) => s + d.tips_amount_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-zinc-600">—</TableCell>
                    <TableCell className="text-right font-mono text-xs text-zinc-600">—</TableCell>
                    <TableCell className="text-right font-mono text-xs text-zinc-600">—</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-zinc-400">
                      {(() => { const t = ptDealers.reduce((s, d) => s + d.pit_deduction_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold text-emerald-400">{formatVND(ptDealers.reduce((s, d) => s + d.net_pay_after_tax_vnd, 0))}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {(() => { const t = ptDealers.reduce((s, d) => s + d.total_adjustments_vnd, 0); return t !== 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* Grand Total */}
          <div className="mt-2 p-4 rounded-lg bg-zinc-900 border border-emerald-600/30">
            <div className="grid grid-cols-4 md:grid-cols-10 gap-3 text-center">
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Dealer</div>
                <div className="text-lg font-bold text-white">{payrollRows.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Ca</div>
                <div className="text-lg font-bold text-white">{totals.totalShifts}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Tổng giờ</div>
                <div className="text-lg font-bold text-white">{formatHours(totals.totalHours)}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Lương cơ bản</div>
                <div className="text-base font-semibold text-zinc-300">{formatVND(totals.totalBase)}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">OT</div>
                <div className="text-base font-semibold text-red-400">{totals.totalOt > 0 ? formatVND(totals.totalOt) : "—"}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Gộp</div>
                <div className="text-base font-semibold text-emerald-400">{formatVND(totals.totalGross)}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Tips</div>
                <div className="text-base font-semibold text-zinc-300">{totals.totalTips > 0 ? formatVND(totals.totalTips) : "—"}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">BHXH</div>
                <div className="text-base font-semibold text-zinc-300">{totals.totalBhxh > 0 ? formatVND(totals.totalBhxh) : "—"}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Sau thuế</div>
                <div className="text-base font-semibold text-emerald-400">{formatVND(totals.totalNetAfterTax)}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Thực lãnh</div>
                <div className="text-lg font-bold text-emerald-400">{formatVND(totals.totalNet)}</div>
              </div>
            </div>
          </div>
        </ScrollArea>
      )}

      {/* Approval footer */}
      {!loading && !error && payrollRows.length > 0 && savedPeriodId && (
        <div className="border border-zinc-800 rounded-lg p-3 bg-zinc-900/50 mt-2">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            {/* Left: status + history */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  payrollStatus === "approved" ? "bg-emerald-500" :
                  payrollStatus === "locked" ? "bg-zinc-500" :
                  payrollStatus === "rejected" ? "bg-red-500" :
                  payrollStatus === "submitted" ? "bg-amber-500" : "bg-zinc-400"
                }`} />
                <span className="text-sm font-medium text-zinc-200">
                  {payrollStatus === "draft" ? "Bản nháp" :
                   payrollStatus === "submitted" ? "Chờ duyệt" :
                   payrollStatus === "approved" ? "Đã duyệt" :
                   payrollStatus === "rejected" ? "Bị từ chối" :
                   payrollStatus === "locked" ? "Đã khoá sổ" : "—"}
                </span>
              </div>
              <div className="text-[11px] text-zinc-500 space-y-0.5">
                {payrollStatus && payrollStatus !== "draft" && (
                  <div>Gửi bởi: <span className="text-zinc-400">{user?.id?.slice(0, 8) ?? "—"}</span></div>
                )}
                {payrollStatus === "approved" && <div>Đã duyệt</div>}
                {payrollStatus === "rejected" && storedRejectionReason && (
                  <div className="text-red-300">Lý do: {storedRejectionReason}</div>
                )}
                {payrollStatus === "locked" && <div>Đã khoá sổ</div>}
              </div>
              <button
                onClick={openAuditLog}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 mt-1 w-fit"
              >
                Xem audit log →
              </button>
            </div>

            {/* Right: actions */}
            <div className="flex flex-col gap-2 min-w-[240px]">
              {payrollStatus === "draft" && (
                <button
                  onClick={handleSubmit}
                  className="h-8 px-3 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium"
                >
                  Gửi duyệt
                </button>
              )}
              {payrollStatus === "submitted" && (
                <>
                  <textarea
                    placeholder="Nhập lý do từ chối..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="h-14 text-xs bg-zinc-900 border border-zinc-700 rounded-md p-2 text-white placeholder:text-zinc-500 resize-none focus:outline-none focus:border-emerald-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReject(rejectionReason)}
                      className="flex-1 h-8 rounded-md border border-red-500 text-red-400 hover:bg-red-950 text-xs font-medium"
                    >
                      Từ chối
                    </button>
                    <button
                      onClick={handleApprove}
                      className="flex-[2] h-8 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                    >
                      Duyệt bảng lương
                    </button>
                  </div>
                </>
              )}
              {payrollStatus === "approved" && (
                <button
                  onClick={handleLock}
                  className="h-8 px-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-xs font-medium"
                >
                  Khoá sổ
                </button>
              )}
              {payrollStatus === "rejected" && (
                <button
                  onClick={handleResubmit}
                  className="h-8 px-3 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
                >
                  Sửa lại và gửi duyệt
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Audit log dialog */}
      <Dialog open={auditLogOpen} onOpenChange={setAuditLogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Lịch sử thay đổi</DialogTitle>
            <DialogDescription>
              Các thay đổi trên bảng lương này
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-auto space-y-2">
            {auditLog.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-4">Chưa có lịch sử</p>
            ) : (
              auditLog.map((entry) => (
                <div key={entry.id} className="text-xs border border-zinc-800 rounded p-2 bg-zinc-900/50">
                  <div className="flex justify-between text-zinc-400">
                    <span className="font-medium">{entry.action}</span>
                    <span>{new Date(entry.changed_at).toLocaleString("vi-VN")}</span>
                  </div>
                  <div className="text-zinc-500 mt-1">
                    {entry.table_name} · {entry.changed_by?.slice(0, 8) ?? "—"}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAuditLogOpen(false)}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjustment Dialog */}
      <Dialog open={adjDialogOpen} onOpenChange={setAdjDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm điều chỉnh</DialogTitle>
            <DialogDescription>
              Thêm thưởng/phạt/khấu trừ cho{" "}
              {payrollRows.find((r) => r.dealer_id === adjustingDealerId)?.full_name ?? "dealer"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-zinc-400">Loại điều chỉnh</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {(Object.entries(ADJ_TYPE_LABELS) as [AdjType, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setAdjType(key)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      adjType === key
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : `bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-white hover:bg-zinc-700`
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Số tiền (VND)</Label>
              <Input
                type="number"
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
                placeholder="VD: 500000"
                className="bg-zinc-900 border-zinc-700 text-white"
              />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Lý do</Label>
              <Input
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder={ADJ_TYPE_LABELS[adjType]}
                className="bg-zinc-900 border-zinc-700 text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjDialogOpen(false)}>Huỷ</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-500 text-white" onClick={handleAddAdjustment} disabled={adjSaving || !adjAmount}>
              {adjSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Thêm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}