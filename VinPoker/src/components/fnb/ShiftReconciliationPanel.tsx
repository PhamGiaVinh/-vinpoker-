import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { mapFnbError } from "@/lib/fnbErrors";
import { useFnbShifts, useFnbShiftReport } from "@/hooks/useFnbShift";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Loader2, DoorOpen, DoorClosed, Wallet } from "lucide-react";

const toInt = (s: string): number => {
  const n = Math.round(Number(String(s).replace(/[^\d-]/g, "")));
  return Number.isFinite(n) ? n : 0;
};
const fmtTime = (iso: string | null): string => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");
// khớp = muted, thừa (>0) = success, thiếu (<0) = destructive — same convention as StocktakeBoard.
const varTone = (v: number | null | undefined): string =>
  v == null || v === 0 ? "text-muted-foreground" : v > 0 ? "text-success" : "text-destructive";
const varLabel = (v: number | null | undefined): string =>
  v == null ? "" : v === 0 ? "(khớp)" : v > 0 ? "(thừa)" : "(thiếu)";
const signed = (v: number | null | undefined): string =>
  v == null ? "—" : (v > 0 ? "+" : "") + formatVND(v);

/**
 * A3 — F&B counter cash-shift reconciliation ("Chốt ca"). Mirrors StocktakeBoard's open→count→commit:
 * open a shift (optional opening float) → take orders on the other tabs → close by counting the drawer
 * and see the variance (khớp/thiếu/thừa) vs system-expected cash. Cash-only. Every mutation routes
 * through the SECURITY DEFINER RPCs; the server re-enforces cashier/owner authz. Parent gates this on
 * FEATURES.fnbShifts && canPay. Untyped fnb_* client.
 */
export function ShiftReconciliationPanel({ clubId, canClose }: { clubId: string; canClose: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useFnbShifts(clubId);
  const openShift = data?.open ?? null;
  const closedRows = (data?.recent ?? []).filter((r) => r.status === "closed");

  const { data: report } = useFnbShiftReport(openShift?.id ?? null);

  const [floatInput, setFloatInput] = useState("");
  const [countedInput, setCountedInput] = useState("");
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fnb", "shifts", clubId] });
    if (openShift?.id) qc.invalidateQueries({ queryKey: ["fnb", "shiftReport", openShift.id] });
  };

  const openShiftFn = async () => {
    setOpening(true);
    const { data: out, error } = await (supabase.rpc as any)("fnb_open_shift", {
      p_club_id: clubId,
      p_opening_float_vnd: toInt(floatInput),
      p_client_request_id: crypto.randomUUID(),
    });
    setOpening(false);
    const res = out as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    toast.success(res?.already_open ? "Ca này đã được mở trước đó." : "Đã mở ca.");
    setFloatInput("");
    invalidate();
  };

  const closeShiftFn = async () => {
    if (!openShift) return;
    if (countedInput.trim() === "") { toast.error("Nhập số tiền mặt đã đếm."); return; }
    setClosing(true);
    const { data: out, error } = await (supabase.rpc as any)("fnb_close_shift", {
      p_shift_id: openShift.id,
      p_counted_cash_vnd: toInt(countedInput),
      p_note: null,
      p_client_request_id: crypto.randomUUID(),
    });
    setClosing(false);
    const res = out as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    const v = Number(res?.variance_vnd ?? 0);
    toast.success(`Đã chốt ca. Chênh lệch: ${signed(v)} ${varLabel(v)}`.trim());
    setCountedInput("");
    invalidate();
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      {!canClose && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          Bạn không có vai trò Thu ngân — không thể mở/chốt ca (chủ CLB cấp quyền ở Quản trị → Nhân sự).
        </div>
      )}

      {/* ── No open shift → open one ─────────────────────────────────────────── */}
      {!openShift ? (
        <Card className="p-5 space-y-3">
          <div className="text-sm font-semibold flex items-center gap-2"><DoorOpen className="w-4 h-4 text-primary" /> Chưa có ca đang mở</div>
          <p className="text-xs text-muted-foreground">Mở ca để bắt đầu tính tiền mặt F&amp;B. Cuối ca, đếm tiền và chốt để xem chênh lệch.</p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Tiền quỹ đầu ca (nếu có)</Label>
              <Input value={floatInput} onChange={(e) => setFloatInput(e.target.value)} inputMode="numeric"
                placeholder="0" className="bg-card border-border text-foreground h-9 w-[160px] font-mono" />
            </div>
            <Button className="h-9" disabled={!canClose || opening} onClick={openShiftFn}>
              {opening ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <DoorOpen className="w-4 h-4 mr-1" />} Mở ca
            </Button>
          </div>
        </Card>
      ) : (
        /* ── Open shift → live totals + close form ──────────────────────────── */
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> Ca đang mở</div>
            <div className="text-xs text-muted-foreground">Mở: {fmtTime(openShift.opened_at)}</div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Tiền quỹ đầu ca" value={formatVND(openShift.opening_float_vnd)} />
            <Stat label="Doanh thu (đã thu)" value={formatVND(report?.sales_vnd ?? 0)} />
            <Stat label="Hoàn tiền" value={report?.refunds_vnd ? `- ${formatVND(report.refunds_vnd)}` : formatVND(0)} tone="#f0997b" />
            <Stat label="Dự kiến trong két" value={formatVND(report?.expected_drawer_vnd ?? openShift.opening_float_vnd)} strong />
          </div>
          {!!report?.comp_count && (
            <div className="text-xs text-muted-foreground">Có {report.comp_count} đơn comp (miễn phí) — không tính vào tiền mặt.</div>
          )}

          <div className="border-t border-border pt-3 flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Tiền mặt đã đếm</Label>
              <Input value={countedInput} onChange={(e) => setCountedInput(e.target.value)} inputMode="numeric"
                placeholder="Đếm trong két" className="bg-card border-border text-foreground h-9 w-[180px] font-mono" />
            </div>
            <Button variant="destructive" className="h-9" disabled={!canClose || closing} onClick={closeShiftFn}>
              {closing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <DoorClosed className="w-4 h-4 mr-1" />} Chốt ca
            </Button>
            {countedInput.trim() !== "" && (
              <div className={`text-sm font-mono self-center ${varTone(toInt(countedInput) - (report?.expected_drawer_vnd ?? openShift.opening_float_vnd))}`}>
                Chênh lệch: {signed(toInt(countedInput) - (report?.expected_drawer_vnd ?? openShift.opening_float_vnd))}{" "}
                {varLabel(toInt(countedInput) - (report?.expected_drawer_vnd ?? openShift.opening_float_vnd))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── History of closed shifts ───────────────────────────────────────── */}
      <Card className="p-4">
        <div className="text-sm font-semibold mb-2">Lịch sử chốt ca</div>
        {closedRows.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">Chưa có ca nào đã chốt.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mở → Chốt</TableHead>
                <TableHead className="text-right">Dự kiến</TableHead>
                <TableHead className="text-right">Đã đếm</TableHead>
                <TableHead className="text-right">Chênh lệch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {closedRows.map((r) => {
                const expectedDrawer = (r.opening_float_vnd ?? 0) + (r.expected_cash_vnd ?? 0);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{fmtTime(r.opened_at)}<br />→ {fmtTime(r.closed_at)}</TableCell>
                    <TableCell className="text-right font-mono">{formatVND(expectedDrawer)}</TableCell>
                    <TableCell className="text-right font-mono">{r.counted_cash_vnd == null ? "—" : formatVND(r.counted_cash_vnd)}</TableCell>
                    <TableCell className={`text-right font-mono ${varTone(r.variance_vnd)}`}>
                      {signed(r.variance_vnd)} <span className="text-[11px]">{varLabel(r.variance_vnd)}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`font-mono ${strong ? "text-base font-semibold" : "text-sm"}`} style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}
