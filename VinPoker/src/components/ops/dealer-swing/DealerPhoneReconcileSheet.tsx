import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface DealerPhoneReconcileTable {
  id: string;
  name: string;
  recordedAttendanceId: string | null;
  recordedDealerName: string | null;
}

export interface DealerPhoneReconcileDealer {
  attendanceId: string;
  dealerName: string;
  currentTableId: string | null;
  state: string;
}

interface ReconcilePlanRow {
  table_id: string;
  expected_assignment_id?: string | null;
  expected_version?: number | null;
}

interface ReconcileResponse {
  outcome: string;
  can_apply?: boolean;
  detail?: string;
  plan?: ReconcilePlanRow[];
  conflicts?: unknown[];
  summary?: { moved?: number; assigned?: number; released?: number };
}

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

interface Props {
  open: boolean;
  activeClubId: string;
  initialTableId: string | null;
  tables: DealerPhoneReconcileTable[];
  dealers: DealerPhoneReconcileDealer[];
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
  onRaceLost: () => void;
  onRolloutDisabled: () => void;
}

const EMPTY = "__empty__";
const rpcReconcile = supabase.rpc as unknown as (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<RpcResult>;

function initialSelections(tables: DealerPhoneReconcileTable[]): Record<string, string> {
  return Object.fromEntries(tables.map((table) => [
    table.id,
    table.recordedAttendanceId ?? EMPTY,
  ]));
}

export function DealerPhoneReconcileSheet({
  open,
  activeClubId,
  initialTableId,
  tables,
  dealers,
  onOpenChange,
  onApplied,
  onRaceLost,
  onRolloutDisabled,
}: Props) {
  const [selections, setSelections] = useState<Record<string, string>>(() => initialSelections(tables));
  const [reason, setReason] = useState("Dealer ngồi nhầm bàn, sửa từ điện thoại");
  const [preview, setPreview] = useState<ReconcileResponse | null>(null);
  const [result, setResult] = useState<ReconcileResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const effectiveAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelections(initialSelections(tables));
    setReason("Dealer ngồi nhầm bàn, sửa từ điện thoại");
    setPreview(null);
    setResult(null);
    effectiveAtRef.current = null;
  }, [open, tables]);

  const tableById = useMemo(
    () => new Map(tables.map((table) => [table.id, table])),
    [tables],
  );
  const dealerByAttendance = useMemo(
    () => new Map(dealers.map((dealer) => [dealer.attendanceId, dealer])),
    [dealers],
  );
  const changedTables = useMemo(
    () => tables.filter((table) => (
      selections[table.id] !== (table.recordedAttendanceId ?? EMPTY)
    )),
    [selections, tables],
  );

  const resetPreview = () => {
    setPreview(null);
    setResult(null);
    effectiveAtRef.current = null;
  };

  const updateSelection = (tableId: string, value: string) => {
    setSelections((current) => ({ ...current, [tableId]: value }));
    resetPreview();
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) resetPreview();
    onOpenChange(nextOpen);
  };

  const validate = (): string | null => {
    if (changedTables.length === 0) return "Chưa có bàn nào thay đổi.";
    if (!reason.trim()) return "Cần nhập lý do sửa sơ đồ.";

    const occupied = new Map<string, string>();
    for (const table of tables) {
      const attendanceId = selections[table.id];
      if (!attendanceId || attendanceId === EMPTY) continue;
      const priorTable = occupied.get(attendanceId);
      if (priorTable) {
        return `${dealerByAttendance.get(attendanceId)?.dealerName ?? "Dealer"} đang được chọn cho cả ${tableById.get(priorTable)?.name ?? "một bàn khác"} và ${table.name}.`;
      }
      occupied.set(attendanceId, table.id);
    }

    for (const table of changedTables) {
      const attendanceId = selections[table.id];
      if (!attendanceId || attendanceId === EMPTY) continue;
      const originId = dealerByAttendance.get(attendanceId)?.currentTableId;
      if (originId && originId !== table.id && selections[originId] === attendanceId) {
        return `Cần sửa cả ${tableById.get(originId)?.name ?? "bàn gốc"} để hoàn tất swap/cycle.`;
      }
    }
    return null;
  };

  const buildPayload = (plan: ReconcilePlanRow[] | null) => {
    const corrections = changedTables.map((table) => {
      const selectedAttendanceId = selections[table.id];
      const correction: Record<string, unknown> = selectedAttendanceId === EMPTY
        ? { table_id: table.id, actual_attendance_id: null, confirm_empty: true }
        : { table_id: table.id, actual_attendance_id: selectedAttendanceId };
      const expected = plan?.find((row) => row.table_id === table.id);
      if (expected) {
        correction.expected_assignment_id = expected.expected_assignment_id ?? null;
        correction.expected_version = expected.expected_version ?? null;
      }
      return correction;
    });

    const finalAttendanceIds = new Set(
      Object.values(selections).filter((value) => value !== EMPTY),
    );
    const displaced = changedTables
      .flatMap((table) => table.recordedAttendanceId ? [table.recordedAttendanceId] : [])
      .filter((attendanceId, index, all) => (
        all.indexOf(attendanceId) === index && !finalAttendanceIds.has(attendanceId)
      ))
      .map((attendanceId) => ({
        attendance_id: attendanceId,
        resolution: "pool_available",
        reason: reason.trim(),
      }));

    return { corrections, displaced };
  };

  const call = async (dryRun: boolean, plan: ReconcilePlanRow[] | null) => {
    const payload = buildPayload(plan);
    const result = await rpcReconcile("dealer_phone_reconcile_room_state", {
      p_expected_club_id: activeClubId,
      p_corrections: payload.corrections,
      p_effective_at: effectiveAtRef.current,
      p_reason: reason.trim(),
      p_displaced: payload.displaced,
      p_dry_run: dryRun,
      p_admin_override: false,
    });
    if (result.error) throw result.error;
    return result.data as ReconcileResponse;
  };

  const runPreview = async () => {
    const validationError = validate();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setBusy(true);
    setResult(null);
    effectiveAtRef.current = new Date().toISOString();
    try {
      const response = await call(true, null);
      if (response.outcome === "rollout_disabled") {
        onRolloutDisabled();
        changeOpen(false);
        toast.warning("Tính năng vừa được quản trị viên tắt.");
        return;
      }
      if (response.outcome === "noop") {
        toast.info("Sơ đồ đã khớp, không cần sửa.");
        return;
      }
      setPreview(response);
    } catch (caught) {
      toast.error((caught as Error)?.message || "Không kiểm tra được sơ đồ bàn.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview?.can_apply || !preview.plan || busy || !effectiveAtRef.current) return;
    setBusy(true);
    try {
      const response = await call(false, preview.plan);
      if (response.outcome === "rollout_disabled") {
        onRolloutDisabled();
        changeOpen(false);
        toast.warning("Tính năng vừa được quản trị viên tắt.");
        return;
      }
      setResult(response);
      if (response.outcome === "applied") {
        onApplied();
      } else if (response.outcome === "race_lost") {
        onRaceLost();
      }
    } catch (caught) {
      toast.error((caught as Error)?.message || "Không áp dụng được sơ đồ bàn.");
    } finally {
      setBusy(false);
    }
  };

  const outcomeText = (response: ReconcileResponse): string => {
    const labels: Record<string, string> = {
      rollout_disabled: "Tính năng vừa được quản trị viên tắt.",
      forbidden: "Không có quyền sửa sơ đồ của CLB này.",
      effective_at_too_old: "Thời điểm sửa vượt quá 120 phút.",
      dealer_not_checked_in: "Có dealer chưa check-in.",
      duplicate_dealer: "Một dealer đang xuất hiện ở nhiều bàn.",
      race_lost: "Sơ đồ vừa thay đổi. Không có thay đổi nào từ yêu cầu này được giữ lại.",
      invalid_corrections: "Danh sách sửa không hợp lệ.",
    };
    return labels[response.outcome] ?? response.detail ?? response.outcome;
  };

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetContent side="bottom" className="ops-sheet max-h-[94dvh] overflow-y-auto rounded-t-[22px] border-none bg-[#0d0913] pb-8">
        <div className="ios-grabber mb-3 mt-1" />
        <SheetHeader className="pr-11 text-left">
          <SheetTitle className="text-[#f2ece6]">Sửa sơ đồ dealer</SheetTitle>
          <SheetDescription className="text-[#9b8e97]">
            Chọn người đang ngồi thật ở từng bàn. Swap 2 bàn và cycle nhiều bàn được xử lý cùng một lần.
          </SheetDescription>
        </SheetHeader>

        {result?.outcome === "applied" ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-[13px] text-emerald-200">
              Đã sửa sơ đồ. Chuyển {result.summary?.moved ?? 0}, gán {result.summary?.assigned ?? 0}, trả pool {result.summary?.released ?? 0} dealer.
            </div>
            <Button type="button" variant="secondary" className="w-full" onClick={() => changeOpen(false)}>Đóng</Button>
          </div>
        ) : (
          <>
            <div className="ios-group mt-4">
              {tables.map((table) => {
                const changed = selections[table.id] !== (table.recordedAttendanceId ?? EMPTY);
                return (
                  <div key={table.id} className={cn("ios-row-inset px-4 py-3", table.id === initialTableId && "bg-[#c9a86a]/5")}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-[14px] font-medium text-[#f2ece6]">{table.name}</span>
                      <span className={cn("text-[11px]", changed ? "text-amber-300" : "text-[#7c7079]")}>
                        {changed ? "đã đổi" : `đang ghi: ${table.recordedDealerName ?? "trống"}`}
                      </span>
                    </div>
                    <Select value={selections[table.id] ?? EMPTY} onValueChange={(value) => updateSelection(table.id, value)}>
                      <SelectTrigger className="border-white/10 bg-white/5 text-[#f2ece6]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={EMPTY}>Bàn đang trống</SelectItem>
                        {dealers.map((dealer) => (
                          <SelectItem key={dealer.attendanceId} value={dealer.attendanceId}>
                            {dealer.dealerName}{dealer.currentTableId ? ` · ${tableById.get(dealer.currentTableId)?.name ?? "đang ở bàn"}` : " · trong pool"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 space-y-1.5">
              <label htmlFor="dealer-phone-reconcile-reason" className="text-[12px] text-[#9b8e97]">Lý do sửa</label>
              <Input
                id="dealer-phone-reconcile-reason"
                value={reason}
                onChange={(event) => { setReason(event.target.value); resetPreview(); }}
                className="border-white/10 bg-white/5 text-[#f2ece6]"
              />
            </div>

            {preview && (!preview.can_apply || preview.outcome !== "dry_run") && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-[12px] text-rose-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{outcomeText(preview)}</span>
              </div>
            )}
            {result && result.outcome !== "applied" && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-[12px] text-rose-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{outcomeText(result)}</span>
              </div>
            )}
            {preview?.outcome === "dry_run" && preview.can_apply && !result && (
              <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-[12px] text-amber-100">
                Server đã kiểm tra {changedTables.length} bàn. Xác nhận để áp dụng cùng một giao dịch.
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => changeOpen(false)}>Hủy</Button>
              {preview?.outcome === "dry_run" && preview.can_apply && !result ? (
                <Button type="button" disabled={busy} onClick={() => void apply()}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  Áp dụng
                </Button>
              ) : (
                <Button type="button" disabled={busy || changedTables.length === 0} onClick={() => void runPreview()}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
                  Kiểm tra
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
