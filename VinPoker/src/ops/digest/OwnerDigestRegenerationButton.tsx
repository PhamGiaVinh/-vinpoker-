import { Loader2, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function OwnerDigestRegenerationButton({
  reportDate,
  busy,
  onConfirm,
}: {
  reportDate: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/8 px-4 text-sm font-semibold text-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
          Tạo lại báo cáo
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border-white/10 bg-[#07100c] text-white">
        <AlertDialogHeader>
          <AlertDialogTitle>Tạo lại báo cáo ngày {formatDate(reportDate)}?</AlertDialogTitle>
          <AlertDialogDescription className="leading-6 text-[#91a49b]">
            Hệ thống sẽ xếp một yêu cầu tính lại từ dữ liệu chuẩn trên server. Báo cáo cũ vẫn được giữ nguyên; nếu số liệu thay đổi, một revision mới sẽ được tạo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-white/10 bg-transparent text-white hover:bg-white/5">Hủy</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-amber-300 text-[#171006] hover:bg-amber-200"
          >
            Xếp yêu cầu tạo lại
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
