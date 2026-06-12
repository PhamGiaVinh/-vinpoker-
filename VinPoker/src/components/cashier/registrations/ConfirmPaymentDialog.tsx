import { useState } from "react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { formatVND } from "@/lib/format";

export type DrawMode = "random_balanced" | "fill_lowest_table";

export interface ConfirmPaymentInfo {
  referenceCode: string;
  totalPay: number;
  buyIn: number;
  platformFixedFee: number;
  tournamentName: string;
  playerName: string;
}

/**
 * Money-action confirmation (master-map §15): restates the exact amount and
 * reference code before the cashier commits. Replaces window.confirm.
 * Draw mode is passed explicitly to confirm_registration_and_assign_seat.
 */
export function ConfirmPaymentDialog({
  open, onOpenChange, info, busy, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  info: ConfirmPaymentInfo | null;
  busy: boolean;
  onConfirm: (drawMode: DrawMode) => void;
}) {
  const [drawMode, setDrawMode] = useState<DrawMode>("random_balanced");
  if (!info) return null;

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xác nhận đã nhận tiền</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Số tiền</span>
                  <span className="font-mono font-bold text-primary">{formatVND(info.totalPay)}</span>
                </div>
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>Buy-in {formatVND(info.buyIn)}{info.platformFixedFee > 0 ? ` + Phí ${formatVND(info.platformFixedFee)}` : ""}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Mã CK</span>
                  <span className="font-mono font-semibold">{info.referenceCode}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Người chơi</span>
                  <span className="font-medium">{info.playerName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Giải</span>
                  <span className="font-medium truncate">{info.tournamentName}</span>
                </div>
              </div>
              <p>Sau khi xác nhận, hệ thống sẽ tự bốc thăm chỗ ngồi và in phiếu xếp ghế. Kết quả là cuối cùng và được ghi vào lịch sử.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs">Chế độ xếp chỗ</Label>
          <Select value={drawMode} onValueChange={(v) => setDrawMode(v as DrawMode)} disabled={busy}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="random_balanced">Bốc thăm cân bàn (mặc định)</SelectItem>
              <SelectItem value="fill_lowest_table">Lấp bàn số nhỏ trước</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Quay lại</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => { e.preventDefault(); onConfirm(drawMode); }}
          >
            {busy ? "Đang xác nhận…" : "Xác nhận đã nhận tiền"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
