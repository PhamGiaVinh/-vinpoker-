import { useState } from "react";
import { ShieldCheck, ShieldOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PT_WAGE_POLICY_REASON_LIMIT } from "@/lib/dealerPtWagePolicyControl";

interface Props {
  futureClubEnabled: boolean;
  loading?: boolean;
  onApply: (enabled: boolean, reason: string) => Promise<void>;
}

/** Server-authoritative all-club policy intent. Only the parent decides when
 * this control is rendered after the privileged read RPC succeeds. */
export default function DealerPtWageGlobalPolicyControl({
  futureClubEnabled,
  loading = false,
  onApply,
}: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const nextEnabled = !futureClubEnabled;

  const openDialog = () => {
    setReason("");
    setAcknowledged(false);
    setOpen(true);
  };

  const submit = async () => {
    if (!acknowledged || !reason.trim() || saving) return;
    setSaving(true);
    try {
      await onApply(nextEnabled, reason);
      setOpen(false);
      setReason("");
      setAcknowledged(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant={futureClubEnabled ? "outline" : "default"}
        className="h-8 text-xs"
        onClick={openDialog}
        disabled={loading || saving}
      >
        {futureClubEnabled
          ? <ShieldOff className="w-3.5 h-3.5 mr-1" />
          : <ShieldCheck className="w-3.5 h-3.5 mr-1" />}
        {futureClubEnabled ? "Dừng toàn bộ CLB" : "Bật toàn bộ CLB"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {nextEnabled ? "Bật tích lũy liên tục cho toàn bộ CLB" : "Dừng tích lũy liên tục cho toàn bộ CLB"}
            </DialogTitle>
            <DialogDescription>
              {nextEnabled
                ? "Tất cả CLB đã duyệt và các CLB được duyệt sau này sẽ dùng chính sách mới. Chỉ thời gian từ mốc máy chủ xác nhận trở đi được tính; phiếu lương đã trả và thời gian chưa trả trước mốc đó không bị viết lại."
                : "Tất cả CLB đã duyệt và CLB được duyệt sau này sẽ quay về giới hạn 24 giờ. Phiếu lương đã trả không thay đổi."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="pt-wage-global-policy-reason" className="text-xs text-zinc-400">Lý do thay đổi</Label>
              <Textarea
                id="pt-wage-global-policy-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={PT_WAGE_POLICY_REASON_LIMIT}
                placeholder="Ghi lý do để lưu audit"
                className="mt-1 bg-zinc-900 border-zinc-700 text-white"
              />
              <div className="mt-1 text-right text-[11px] text-zinc-500">{reason.length}/{PT_WAGE_POLICY_REASON_LIMIT}</div>
            </div>
            <label className="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(checked) => setAcknowledged(checked === true)}
                className="mt-0.5"
              />
              <span>
                {nextEnabled
                  ? "Tôi hiểu hệ thống không tính ngược giờ cũ và không sửa phiếu lương đã trả."
                  : "Tôi hiểu thao tác này chỉ đổi chính sách cho các lần đọc lương sau, không sửa phiếu lương đã trả."}
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Huỷ</Button>
            <Button
              className={nextEnabled ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-amber-600 hover:bg-amber-500 text-white"}
              onClick={submit}
              disabled={saving || !acknowledged || !reason.trim()}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {nextEnabled ? "Xác nhận bật toàn bộ" : "Xác nhận dừng toàn bộ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
