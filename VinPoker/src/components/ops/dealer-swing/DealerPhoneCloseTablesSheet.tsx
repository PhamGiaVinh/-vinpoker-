import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface DealerPhoneCloseTable {
  id: string;
  name: string;
  dealer: string | null;
}

interface CloseSnapshot {
  state_hash: string;
  tables: Array<{
    table_id: string;
    table_name: string;
    state_hash: string;
  }>;
}

interface CloseResponse {
  outcome: "dry_run" | "completed" | "conflict" | "rollout_disabled" | "invalid_request" | "idempotency_conflict" | "batch_too_large";
  operation_id?: string;
  state_hash?: string;
  tables?: CloseSnapshot["tables"];
  tables_closed?: number;
  dealers_released?: number;
  results?: Array<{ table_id: string; code: string }>;
  reason?: string;
}

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

interface Props {
  open: boolean;
  activeClubId: string;
  tables: DealerPhoneCloseTable[];
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
  onConflict: () => void;
  onRolloutDisabled: () => void;
}

const rpcClose = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<RpcResult>;

export function DealerPhoneCloseTablesSheet({
  open,
  activeClubId,
  tables,
  onOpenChange,
  onCompleted,
  onConflict,
  onRolloutDisabled,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snapshot, setSnapshot] = useState<CloseSnapshot | null>(null);
  const [response, setResponse] = useState<CloseResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const operationIdRef = useRef<string | null>(null);

  const selectedTables = useMemo(
    () => tables.filter((table) => selected.has(table.id)),
    [selected, tables],
  );

  const resetConfirmation = () => {
    setSnapshot(null);
    setResponse(null);
    operationIdRef.current = null;
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelected(new Set());
      resetConfirmation();
    }
    onOpenChange(nextOpen);
  };

  const toggleTable = (tableId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(tableId)) next.delete(tableId);
      else next.add(tableId);
      return next;
    });
    resetConfirmation();
  };

  const handleGateOutcome = (result: CloseResponse): boolean => {
    if (result.outcome !== "rollout_disabled") return false;
    onRolloutDisabled();
    changeOpen(false);
    toast.warning("Tính năng vừa được quản trị viên tắt.");
    return true;
  };

  const preview = async () => {
    if (selected.size === 0 || busy) return;
    const operationId = crypto.randomUUID();
    operationIdRef.current = operationId;
    setBusy(true);
    setResponse(null);
    try {
      const result = await rpcClose("close_dealer_tables", {
        p_request_id: operationId,
        p_expected_club_id: activeClubId,
        p_shift_id: null,
        p_table_ids: [...selected].sort(),
        p_expected_state: null,
        p_dry_run: true,
      });
      if (result.error) throw result.error;
      const data = result.data as CloseResponse;
      if (handleGateOutcome(data)) return;
      if (data.outcome !== "dry_run" || !data.state_hash || !data.tables) {
        setResponse(data);
        return;
      }
      setSnapshot({ state_hash: data.state_hash, tables: data.tables });
    } catch (caught) {
      toast.error((caught as Error)?.message || "Không kiểm tra được trạng thái bàn.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    const operationId = operationIdRef.current;
    if (!operationId || !snapshot || busy) return;
    setBusy(true);
    try {
      const result = await rpcClose("close_dealer_tables", {
        p_request_id: operationId,
        p_expected_club_id: activeClubId,
        p_shift_id: null,
        p_table_ids: [...selected].sort(),
        p_expected_state: snapshot,
        p_dry_run: false,
      });
      if (result.error) throw result.error;
      const data = result.data as CloseResponse;
      if (handleGateOutcome(data)) return;
      setResponse(data);

      if (data.outcome === "conflict") {
        onConflict();
        return;
      }
      if (data.outcome !== "completed") return;

      onCompleted();
      const names = selectedTables.map((table) => table.name).join(", ");
      const notification = await supabase.functions.invoke("telegram-swing-notifier", {
        body: {
          chat_id: "__club__",
          club_id: activeClubId,
          operation_id: operationId,
          message: `🔒 Đóng bàn (${data.tables_closed ?? selectedTables.length} bàn): ${names}`,
          parse_mode: "HTML",
        },
      });
      if (notification.error) {
        toast.warning("Bàn đã đóng, nhưng Telegram chưa gửi được.");
      }
    } catch (caught) {
      toast.error((caught as Error)?.message || "Không đóng được bàn. Có thể thử lại an toàn.");
    } finally {
      setBusy(false);
    }
  };

  const conflictIds = new Set(
    (response?.results ?? [])
      .filter((result) => result.code === "conflict")
      .map((result) => result.table_id),
  );

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetContent side="bottom" className="ops-sheet max-h-[92dvh] overflow-y-auto rounded-t-[22px] border-none bg-[#0d0913] pb-8">
        <div className="ios-grabber mb-3 mt-1" />
        <SheetHeader className="pr-11 text-left">
          <SheetTitle className="text-[#f2ece6]">Đóng bàn</SheetTitle>
          <SheetDescription className="text-[#9b8e97]">
            Chỉ đóng đúng bàn đã chọn. Dealer được trả về khu nghỉ; tour không bị đóng.
          </SheetDescription>
        </SheetHeader>

        {!snapshot && response?.outcome !== "completed" && (
          <>
            <div className="ios-group mt-4 max-h-[48vh] overflow-y-auto">
              {tables.length === 0 ? (
                <div className="px-4 py-6 text-center text-[13px] text-[#9b8e97]">Không có bàn active để đóng.</div>
              ) : tables.map((table) => {
                const checked = selected.has(table.id);
                return (
                  <button
                    type="button"
                    key={table.id}
                    onClick={() => toggleTable(table.id)}
                    className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <span className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded border",
                      checked ? "border-[#c9a86a] bg-[#c9a86a] text-[#241a08]" : "border-white/20 text-transparent",
                    )}><Check className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] text-[#f2ece6]">{table.name}</span>
                      <span className="block truncate text-[11px] text-[#9b8e97]">{table.dealer ?? "Chưa có dealer"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {response && (
              <p className="mt-3 text-[12px] text-amber-300">Không thể tạo xác nhận: {response.reason ?? response.outcome}</p>
            )}
            <Button type="button" className="mt-4 min-h-11 w-full" disabled={selected.size === 0 || busy} onClick={() => void preview()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LockKeyhole className="mr-2 h-4 w-4" />}
              Kiểm tra {selected.size} bàn
            </Button>
          </>
        )}

        {snapshot && response?.outcome !== "completed" && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-4 py-3">
              <div className="text-[14px] font-semibold text-amber-200">Xác nhận đóng {selectedTables.length} bàn</div>
              <div className="mt-1 text-[12px] leading-5 text-amber-100/80">
                {selectedTables.map((table) => `${table.name}${table.dealer ? ` · ${table.dealer}` : ""}`).join("; ")}
              </div>
            </div>

            {response?.outcome === "conflict" && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-[12px] text-rose-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Trạng thái vừa thay đổi ở {selectedTables.filter((table) => conflictIds.has(table.id)).map((table) => table.name).join(", ") || "bàn đã chọn"}. Không bàn nào bị đóng; hãy kiểm tra lại.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={resetConfirmation}>Chọn lại</Button>
              <Button type="button" variant="destructive" disabled={busy || response?.outcome === "conflict"} onClick={() => void apply()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LockKeyhole className="mr-2 h-4 w-4" />}
                Đóng bàn
              </Button>
            </div>
          </div>
        )}

        {response?.outcome === "completed" && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-[13px] text-emerald-200">
              Đã đóng {response.tables_closed ?? selectedTables.length} bàn và trả {response.dealers_released ?? 0} dealer về khu nghỉ.
            </div>
            <Button type="button" variant="secondary" className="w-full" onClick={() => changeOpen(false)}>Đóng</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
