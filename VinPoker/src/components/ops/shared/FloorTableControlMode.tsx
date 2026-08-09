import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { floorOpsErrorMessage } from "@/lib/floorOpsErrors";
import type { FloorTableControlMode } from "@/lib/floorTableControlMode";
import { FloorTableModePicker } from "@/components/ops/shared/FloorTableModePicker";

type UntypedFloorRpcResult = {
  data: unknown;
  error: { message?: string; code?: string } | null;
};

type ControlTable = {
  tt_id: string;
  table_name: string;
  floor_control_mode: FloorTableControlMode;
  floor_control_revision: number;
};

export function FloorTableControlModeControl({
  tournamentId,
  table,
  onChanged,
}: {
  tournamentId: string;
  table: ControlTable;
  onChanged: () => void;
}) {
  const supabase = useSupabaseClient();
  const callUntypedFloorRpc = useMemo(
    () => supabase.rpc.bind(supabase) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<UntypedFloorRpcResult>,
    [supabase],
  );
  const [selected, setSelected] = useState<FloorTableControlMode>(table.floor_control_mode);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    setSelected(table.floor_control_mode);
    setConfirmOpen(false);
  }, [table.tt_id, table.floor_control_mode, table.floor_control_revision]);

  const changed = selected !== table.floor_control_mode;
  const selectedSummary = selected === "tracker"
    ? "Live Tracker: chỉ cho phép loại khi chip đã về 0 và phải chọn chế độ này trước khi bắt đầu hand."
    : "Manual Floor: cho phép loại dù còn chip; chip trước khi loại được ghi audit, không payout.";

  const save = async () => {
    if (!changed || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const { data, error } = await callUntypedFloorRpc("floor_set_table_control_mode", {
        p_tournament_id: tournamentId,
        p_tournament_table_id: table.tt_id,
        p_control_mode: selected,
        p_expected_control_revision: table.floor_control_revision,
      });
      const result = (data ?? null) as { ok?: boolean; error?: string } | null;
      if (error || !result?.ok) {
        toast.error(floorOpsErrorMessage(result?.error ?? error?.message, "Không đổi được chế độ bàn."));
        return;
      }
      toast.success(selected === "tracker" ? "Đã đặt bàn là Live Tracker." : "Đã đặt bàn là Manual Floor.");
      setConfirmOpen(false);
      onChanged();
    } catch {
      toast.error("Không đổi được chế độ bàn. Hãy kiểm tra mạng rồi tải lại.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section data-testid="floor-table-control-mode" className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Kiểm soát chip khi loại</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Chọn rõ bàn này là Manual Floor hay Live Tracker. Cả hai chế độ đều chặn loại khi ván đang chạy; hand Live Tracker chỉ bắt đầu sau khi bàn đã được đánh dấu Tracker.
          </p>
        </div>
      </div>

      <div className="mt-3">
        <FloorTableModePicker
          value={selected}
          onChange={setSelected}
          disabled={busy}
          testIdPrefix="floor-table-control-mode"
        />
      </div>

      <Button
        data-ops-action="floor.tables.open_control_mode_confirm"
        data-testid="floor-table-control-mode-save"
        type="button"
        className="mt-3 w-full"
        disabled={!changed || busy}
        onClick={() => setConfirmOpen(true)}
      >
        Lưu chế độ bàn
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Đổi kiểm soát chip của {table.table_name}</AlertDialogTitle>
            <AlertDialogDescription>{selectedSummary} Ván đang chạy luôn bị chặn.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel data-ops-action="floor.tables.cancel_control_mode" disabled={busy}>Huỷ</AlertDialogCancel>
            <AlertDialogAction data-ops-action="floor.tables.save_control_mode" data-testid="floor-table-control-mode-confirm" disabled={busy} onClick={(event) => { event.preventDefault(); void save(); }}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Đang lưu</> : "Xác nhận đổi chế độ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
