import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const REASON_PRESETS = [
  "Không nhận được tiền",
  "Người chơi yêu cầu huỷ",
  "Đăng ký trùng",
] as const;

/**
 * Destructive-action dialog with mandatory reason (master-map §15 — replaces prompt()).
 * The reason is stored in tournament_registrations.cancellation_reason for audit.
 */
export function CancelRegistrationDialog({
  open, onOpenChange, playerName, referenceCode, busy, onCancel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  playerName: string;
  referenceCode: string;
  busy: boolean;
  onCancel: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) setReason(""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Huỷ đăng ký</DialogTitle>
          <DialogDescription>
            Huỷ đăng ký <span className="font-mono font-semibold">{referenceCode}</span> của{" "}
            <span className="font-medium">{playerName}</span>. Lý do là bắt buộc và được lưu vào lịch sử.
          </DialogDescription>
        </DialogHeader>
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
            <Label htmlFor="cancel-reason" className="text-xs">Lý do huỷ</Label>
            <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Nhập lý do…" rows={2} disabled={busy} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Quay lại</Button>
          <Button variant="destructive" disabled={busy || !trimmed} onClick={() => onCancel(trimmed)}>
            {busy ? "Đang huỷ…" : "Huỷ đăng ký"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
