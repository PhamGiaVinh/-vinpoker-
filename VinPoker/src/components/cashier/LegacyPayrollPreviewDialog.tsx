import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function LegacyPayrollPreviewDialog(props: {
  preview: { title: string; html: string } | null;
  onOpenChange: (open: boolean) => void;
  onDownload: () => void;
}) {
  const { preview, onOpenChange, onDownload } = props;
  return (
    <Dialog open={preview !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92dvh,960px)] max-w-[min(96vw,1080px)] flex-col gap-0 overflow-hidden p-0 sm:rounded-lg">
        <DialogHeader className="border-b border-border bg-card px-4 py-3 text-left sm:px-5">
          <div className="flex min-w-0 items-start gap-3 pr-8">
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{preview?.title ?? "Bản xem tạm tính"}</DialogTitle>
              <DialogDescription className="mt-0.5">Bản xem trực tiếp từ số liệu hiện tại, chưa phải phiếu bất biến để gửi Telegram.</DialogDescription>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={onDownload}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Tải PDF
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto bg-[#dfe5e0] p-2 sm:p-4">
          {preview ? (
            <iframe
              title="Bản xem tạm tính phiếu lương"
              sandbox=""
              srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${preview.html}</body></html>`}
              className="h-full min-h-[620px] w-full border-0 bg-[#dfe5e0]"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
