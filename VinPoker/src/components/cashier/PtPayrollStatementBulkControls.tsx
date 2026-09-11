import { useState } from "react";
import { FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import type { usePtPayrollStatements } from "@/hooks/usePtPayrollStatements";

export function PtPayrollStatementBulkControls(props: {
  controller: ReturnType<typeof usePtPayrollStatements>;
  clubName: string;
  periodLabel: string;
  totalDealers: number;
}) {
  const { controller, clubName, periodLabel, totalDealers } = props;
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (controller.availability !== "ready" || totalDealers === 0) return null;

  const prepare = async () => {
    try {
      const result = await controller.prepareAll();
      setConfirmOpen(false);
      if (!result) {
        toast.error("Chưa xác nhận được đợt chuẩn bị phiếu PT. Hãy tải lại trạng thái.");
        return;
      }
      if (result.failed > 0 || result.pdfFailed > 0) {
        toast.warning(`Đã chuẩn bị ${result.pdfReady} PDF; ${result.failed + result.pdfFailed} phiếu cần đối chiếu.`);
        return;
      }
      toast.success(`Đã chuẩn bị ${result.pdfReady} PDF PT; bỏ qua ${result.skipped} dealer chưa có số dư.`);
    } catch {
      toast.error("Không chuẩn bị được PDF PT. Không có phiếu nào được tự động gửi Telegram.");
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 text-xs"
        onClick={() => setConfirmOpen(true)}
        disabled={!controller.canFinalize || controller.preparing}
      >
        {controller.preparing
          ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          : <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />}
        Chuẩn bị phiếu PT
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Chốt và tạo PDF cho dealer PT?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1 text-sm">
                  <span>CLB</span><strong className="text-foreground">{clubName}</strong>
                  <span>Kỳ lương</span><strong className="text-foreground">{periodLabel}</strong>
                  <span>Dealer PT</span><strong className="text-foreground">{totalDealers}</strong>
                </div>
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                  Mỗi phiếu sẽ khóa số dư PT tại thời điểm server chốt và trở thành bản ghi bất biến. Dealer chưa có số dư được bỏ qua.
                </div>
                <p className="text-xs text-muted-foreground">
                  Bước này chỉ chốt phiếu và tạo PDF. Không chuyển tiền, không tạo payout và chưa gửi Telegram.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={controller.preparing}>Quay lại</AlertDialogCancel>
            <AlertDialogAction
              disabled={controller.preparing}
              onClick={(event) => { event.preventDefault(); void prepare(); }}
            >
              {controller.preparing
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <FileCheck2 className="mr-2 h-4 w-4" />}
              Chốt và tạo PDF
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
