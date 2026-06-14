import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatVND } from "@/lib/format";

const REASON_PRESETS = [
  "Người chơi đổi ý / rời giải",
  "Xác nhận nhầm",
  "Đăng ký trùng",
  "Sai số tiền",
] as const;

/**
 * Void a CONFIRMED registration: frees the seat, cancels the entry + receipt, and
 * reverses the revenue (rake auto-drops). The cash refund is handed back manually
 * at the counter — this dialog only shows the amount that was paid. Reason is
 * mandatory and stored in tournament_registrations.cancellation_reason for audit.
 */
export function VoidRegistrationDialog({
  open, onOpenChange, playerName, referenceCode, refundAmount, seatLabel, busy, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  playerName: string;
  referenceCode: string;
  refundAmount: number;
  /** e.g. "Bàn 2 · Ghế 5" — the seat that will be freed, when known. */
  seatLabel?: string | null;
  busy: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) setReason(""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Huỷ & hoàn (void)</DialogTitle>
          <DialogDescription>
            Huỷ đăng ký đã xác nhận <span className="font-mono font-semibold">{referenceCode}</span> của{" "}
            <span className="font-medium">{playerName}</span>. Ghế sẽ được giải phóng và doanh thu (rake) tự trừ.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Hoàn lại cho khách (tiền mặt)</span>
              <span className="font-mono font-bold text-destructive">{formatVND(refundAmount)}</span>
            </div>
            {seatLabel && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Ghế giải phóng</span>
                <span className="font-medium">{seatLabel}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {REASON_PRESETS.map((p) => (
                <Button key={p} type="button" size="sm" variant={reason === p ? "default" : "outline"}
                  className="h-8 text-xs" disabled={busy} onClick={() => setReason(p)}>
                  {p}
                </Button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="void-reason" className="text-xs">Lý do huỷ (bắt buộc)</Label>
              <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Nhập lý do…" rows={2} disabled={busy} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Quay lại</Button>
          <Button variant="destructive" disabled={busy || !trimmed} onClick={() => onConfirm(trimmed)}>
            {busy ? "Đang huỷ…" : "Huỷ & hoàn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
