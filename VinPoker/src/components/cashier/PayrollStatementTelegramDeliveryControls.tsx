import { useState } from "react";
import { AlertCircle, Loader2, Send, ShieldCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { usePayrollStatementTelegramDelivery } from "@/hooks/usePayrollStatementTelegramDelivery";

type Controller = ReturnType<typeof usePayrollStatementTelegramDelivery>;

export function PayrollStatementTelegramDeliveryControls(props: {
  controller: Controller;
  clubName: string;
  periodLabel: string;
}) {
  const { controller, clubName, periodLabel } = props;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Dark rollout means there is deliberately no visible send affordance until
  // both source and server gates are approved for the selected club.
  if (controller.availability !== "ready") return null;

  const operation = controller.operation;
  const complete = operation?.state === "completed";
  const partial = operation?.state === "partial";
  const canResume = operation?.state === "ready" && operation.pending_count > 0;
  const send = async () => {
    setBusy(true);
    try {
      const outcome = await controller.sendAll();
      if (!outcome) {
        toast.error("Chưa xác nhận được kết quả gửi. Không có lần gửi tự động nào được tạo thêm.");
      } else if (outcome.state === "completed") {
        toast.success(`Đã gửi ${outcome.sent_count} phiếu qua Telegram`);
      } else {
        toast.warning("Đợt gửi đã hoàn tất một phần. Hãy tải lại trạng thái trước khi xử lý tiếp.");
      }
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      {operation ? (
        <Badge variant="outline" className={partial ? "border-warning/60 text-warning" : complete ? "border-success/60 text-success" : "border-sky-500/60 text-sky-400"}>
          {complete ? "Telegram đã gửi" : partial ? "Telegram cần đối chiếu" : "Đang gửi Telegram"}
        </Badge>
      ) : null}
      <Button
        type="button"
        size="sm"
        className="h-8 bg-[#168a45] text-xs text-white hover:bg-[#0f7136]"
        onClick={() => setConfirmOpen(true)}
        disabled={!controller.canSend || busy || operation?.state === "dispatching"}
      >
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
        {canResume ? "Gửi tiếp Telegram" : "Gửi Telegram"}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gửi phiếu lương qua Telegram?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                <div className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-1 text-sm">
                  <span>CLB</span><strong className="text-foreground">{clubName}</strong>
                  <span>Kỳ lương</span><strong className="text-foreground">{periodLabel}</strong>
                </div>
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                  Phiếu đã chốt và PDF sẵn sàng sẽ được gửi tới tài khoản Telegram đã liên kết. Người chưa liên kết Telegram được bỏ qua.
                </div>
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  Chỉ Owner hoặc Super Admin mới có thể tạo đợt gửi. Hệ thống không tự chốt phiếu và không tạo payout.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Quay lại</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void send(); }} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Gửi phiếu
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {operation?.telegram_unlinked_count ? (
        <span className="hidden items-center gap-1 text-[11px] text-warning xl:flex" title="Dealer chưa liên kết Telegram được bỏ qua">
          <UserX className="h-3.5 w-3.5" /> {operation.telegram_unlinked_count} chưa liên kết
        </span>
      ) : null}
      {controller.error ? (
        <span className="hidden items-center gap-1 text-[11px] text-warning xl:flex" title={controller.error}>
          <AlertCircle className="h-3.5 w-3.5" /> Cần đối chiếu
        </span>
      ) : null}
    </div>
  );
}
