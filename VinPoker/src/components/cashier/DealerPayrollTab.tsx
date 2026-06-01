import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { exportToExcel, type ExcelColumn } from "@/lib/exportExcel";
import {
  useDealerPayroll, type DealerPayrollRow,
} from "@/hooks/useDealerPayroll";
import {
  Users, RefreshCw, Download, ChevronDown, ChevronRight, Calculator,
} from "lucide-react";

type ClubRow = { id: string; name: string };

interface DealerPayrollTabProps {
  clubIds: string[];
  clubs: ClubRow[];
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

function getMonthYearOptions(): { value: string; label: string; start: string; end: string }[] {
  const options: { value: string; label: string; start: string; end: string }[] = [];
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
    options.push({ value, label, start, end });
  }
  return options;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function DealerPayrollTab({ clubIds, clubs }: DealerPayrollTabProps) {
  const monthOptions = useMemo(() => getMonthYearOptions(), []);
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.value ?? "");
  const currentRange = useMemo(() => monthOptions.find((o) => o.value === selectedMonth), [monthOptions, selectedMonth]);

  const [clubFilter, setClubFilter] = useState<string>(clubIds.length === 1 ? clubIds[0] : "");

  const { data: payrollRows, period, loading, error, fetchPayroll } = useDealerPayroll(clubIds);

  const activeClubId = clubFilter || clubIds[0] || "";

  // Auto-fetch when month or club changes
  useEffect(() => {
    if (!activeClubId || !currentRange) return;
    fetchPayroll(activeClubId, currentRange.start, currentRange.end);
  }, [activeClubId, currentRange, fetchPayroll]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const ftDealers = useMemo(() => payrollRows.filter((d) => d.employment_type === "full_time"), [payrollRows]);
  const ptDealers = useMemo(() => payrollRows.filter((d) => d.employment_type === "part_time"), [payrollRows]);

  const totals = useMemo(() => {
    const totalGross = payrollRows.reduce((s, d) => s + d.gross_pay_vnd, 0);
    const totalBase = payrollRows.reduce((s, d) => s + d.base_salary_vnd, 0);
    const totalOt = payrollRows.reduce((s, d) => s + d.ot_pay_vnd, 0);
    const totalNet = payrollRows.reduce((s, d) => s + d.net_pay_vnd, 0);
    const totalAdjust = payrollRows.reduce((s, d) => s + d.total_adjustments_vnd, 0);
    const totalHours = payrollRows.reduce((s, d) => s + d.total_hours, 0);
    const totalShifts = payrollRows.reduce((s, d) => s + d.total_shifts, 0);
    return { totalGross, totalBase, totalOt, totalNet, totalAdjust, totalHours, totalShifts };
  }, [payrollRows]);

  // ── Export ─────────────────────────────────────────────────────────────────

  const doExport = useCallback(() => {
    if (!payrollRows.length) return;
    const clubName = clubs.find((c) => c.id === activeClubId)?.name ?? "club";
    const monthLabel = currentRange?.label ?? selectedMonth;
    const allRows = [...ftDealers, ...ptDealers];
    const columns: ExcelColumn<DealerPayrollRow>[] = [
      { header: "Tên", get: (r) => r.full_name },
      { header: "Loại", get: (r) => r.employment_type === "full_time" ? "FT" : "PT" },
      { header: "Ca", get: (r) => r.total_shifts },
      { header: "Tổng giờ", get: (r) => r.total_hours ? Number(r.total_hours.toFixed(1)) : 0 },
      { header: "Giờ chuẩn", get: (r) => r.regular_hours ? Number(r.regular_hours.toFixed(1)) : 0 },
      { header: "Giờ OT", get: (r) => r.ot_hours ? Number(r.ot_hours.toFixed(1)) : 0 },
      { header: "Lương cơ bản (VND)", get: (r) => r.base_salary_vnd },
      { header: "Lương giờ (VND)", get: (r) => r.hourly_rate_vnd },
      { header: "Lương thường (VND)", get: (r) => r.regular_pay_vnd },
      { header: "Lương OT (VND)", get: (r) => r.ot_pay_vnd },
      { header: "Tổng gộp (VND)", get: (r) => r.gross_pay_vnd },
      { header: "Điều chỉnh (VND)", get: (r) => r.total_adjustments_vnd },
      { header: "Thực lãnh (VND)", get: (r) => r.net_pay_vnd },
    ];
    exportToExcel(allRows, columns, `luong-${clubName}-${monthLabel}`, "Bảng lương");
    toast.success(`Đã tải bảng lương ${monthLabel}`);
  }, [payrollRows, ftDealers, ptDealers, clubs, activeClubId, currentRange, selectedMonth]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderRow = (r: DealerPayrollRow) => (
    <TableRow key={r.dealer_id} className="hover:bg-zinc-800/50">
      <TableCell className="font-medium text-white text-sm">
        {r.full_name}
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={`text-[10px] ${
            r.employment_type === "full_time"
              ? "border-emerald-500 text-emerald-400"
              : "border-amber-500 text-amber-400"
          }`}
        >
          {r.employment_type === "full_time" ? "FT" : "PT"}
        </Badge>
      </TableCell>
      <TableCell className="text-center text-zinc-300 text-xs">{r.total_shifts || "—"}</TableCell>
      <TableCell className="text-right font-mono text-xs text-zinc-300">{formatHours(r.total_hours)}</TableCell>
      <TableCell className="text-right font-mono text-xs text-zinc-300">{formatHours(r.regular_hours)}</TableCell>
      <TableCell className={`text-right font-mono text-xs ${r.ot_hours > 0 ? "text-red-400 font-semibold" : "text-zinc-500"}`}>
        {r.ot_hours > 0 ? formatHours(r.ot_hours) : "—"}
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-zinc-300">
        {r.employment_type === "full_time"
          ? r.monthly_salary_vnd ? formatVNDShort(r.monthly_salary_vnd) : "—"
          : r.hourly_rate_vnd ? `${(r.hourly_rate_vnd / 1000).toFixed(0)}K/h` : "—"
        }
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-zinc-300">{formatVND(r.regular_pay_vnd)}</TableCell>
      <TableCell className={`text-right font-mono text-xs ${r.ot_pay_vnd > 0 ? "text-red-400" : "text-zinc-500"}`}>
        {r.ot_pay_vnd > 0 ? formatVND(r.ot_pay_vnd) : "—"}
      </TableCell>
      <TableCell className="text-right font-mono text-xs font-semibold text-emerald-400">{formatVND(r.gross_pay_vnd)}</TableCell>
      <TableCell className={`text-right font-mono text-xs ${r.total_adjustments_vnd > 0 ? "text-emerald-400" : r.total_adjustments_vnd < 0 ? "text-red-400" : "text-zinc-500"}`}>
        {r.total_adjustments_vnd !== 0 ? formatVND(r.total_adjustments_vnd) : "—"}
      </TableCell>
      <TableCell className="text-right font-mono text-xs font-bold text-emerald-400">{formatVND(r.net_pay_vnd)}</TableCell>
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
          onClick={() => {
            if (activeClubId && currentRange) {
              fetchPayroll(activeClubId, currentRange.start, currentRange.end);
            }
          }}
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

        <div className="flex-1" />

        <div className="text-xs text-zinc-500">
          {payrollRows.length > 0 && (
            <span>{payrollRows.length} dealer · {period.start} → {period.end}</span>
          )}
        </div>
      </div>

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

      {/* Data */}
      {!loading && !error && payrollRows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
          <Calculator className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">Chưa có dữ liệu lương cho tháng này</p>
          <p className="text-xs mt-1">Chọn tháng và CLB, rồi nhấn "Làm mới"</p>
        </div>
      )}

      {!loading && !error && payrollRows.length > 0 && (
        <ScrollArea className="flex-1">
          {/* FT Section */}
          {ftDealers.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-emerald-600 text-white text-[10px]">Full-time</Badge>
                <span className="text-xs text-zinc-400">{ftDealers.length} dealer</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800">
                    <TableHead className="text-zinc-400 text-xs">Tên</TableHead>
                    <TableHead className="text-zinc-400 text-xs w-12 text-center">Loại</TableHead>
                    <TableHead className="text-zinc-400 text-xs w-10 text-center">Ca</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Tổng giờ</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Giờ chuẩn</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">OT</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Lương CB</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Thường</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">OT pay</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Gộp</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Điều chỉnh</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Thực lãnh</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ftDealers.map(renderRow)}
                  {/* FT subtotal */}
                  <TableRow className="border-t-2 border-emerald-600/30 bg-emerald-600/5">
                    <TableCell className="font-bold text-emerald-400 text-xs" colSpan={3}>
                      FT subtotal
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {formatHours(ftDealers.reduce((s, d) => s + d.total_hours, 0))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {formatHours(ftDealers.reduce((s, d) => s + d.regular_hours, 0))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-red-400">
                      {(() => { const total = ftDealers.reduce((s, d) => s + d.ot_hours, 0); return total > 0 ? formatHours(total) : "—"; })()}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {formatVND(ftDealers.reduce((s, d) => s + d.regular_pay_vnd, 0))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-red-400">
                      {(() => { const t = ftDealers.reduce((s, d) => s + d.ot_pay_vnd, 0); return t > 0 ? formatVND(t) : "—"; })()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-emerald-400">
                      {formatVND(ftDealers.reduce((s, d) => s + d.gross_pay_vnd, 0))}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-bold text-emerald-400">
                      {formatVND(ftDealers.reduce((s, d) => s + d.net_pay_vnd, 0))}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* PT Section */}
          {ptDealers.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge className="bg-amber-600 text-white text-[10px]">Part-time</Badge>
                <span className="text-xs text-zinc-400">{ptDealers.length} dealer</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800">
                    <TableHead className="text-zinc-400 text-xs">Tên</TableHead>
                    <TableHead className="text-zinc-400 text-xs w-12 text-center">Loại</TableHead>
                    <TableHead className="text-zinc-400 text-xs w-10 text-center">Ca</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Tổng giờ</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Giờ chuẩn</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">OT</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Giờ rate</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Thường</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">OT pay</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Gộp</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Điều chỉnh</TableHead>
                    <TableHead className="text-zinc-400 text-xs text-right">Thực lãnh</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ptDealers.map(renderRow)}
                  {/* PT subtotal */}
                  <TableRow className="border-t-2 border-amber-600/30 bg-amber-600/5">
                    <TableCell className="font-bold text-amber-400 text-xs" colSpan={3}>
                      PT subtotal
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {formatHours(ptDealers.reduce((s, d) => s + d.total_hours, 0))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {formatHours(ptDealers.reduce((s, d) => s + d.regular_hours, 0))}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-semibold">
                      {formatVND(ptDealers.reduce((s, d) => s + d.regular_pay_vnd, 0))}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-semibold text-emerald-400">
                      {formatVND(ptDealers.reduce((s, d) => s + d.gross_pay_vnd, 0))}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-bold text-emerald-400">
                      {formatVND(ptDealers.reduce((s, d) => s + d.net_pay_vnd, 0))}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* Grand Total */}
          <div className="mt-2 p-4 rounded-lg bg-zinc-900 border border-emerald-600/30">
            <div className="grid grid-cols-4 md:grid-cols-7 gap-3 text-center">
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
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Thực lãnh</div>
                <div className="text-lg font-bold text-emerald-400">{formatVND(totals.totalNet)}</div>
              </div>
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}