import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ShiftStatus } from "@/types/shiftPlanner";

const STYLE: Record<string, string> = {
  published: "bg-blue-500/12 text-blue-400 border-blue-500/30",
  confirmed: "bg-primary/12 text-primary border-primary/35",
  checked_in: "bg-primary/15 text-primary border-primary/45",
  closed: "bg-muted text-muted-foreground border-border",
  draft: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-destructive/12 text-destructive border-destructive/30",
  no_show: "bg-destructive/12 text-destructive border-destructive/30",
};

const FALLBACK: Record<string, string> = {
  draft: "Nháp",
  published: "Chưa xác nhận",
  confirmed: "Đã xác nhận",
  checked_in: "Đang làm",
  closed: "Đã kết thúc",
  cancelled: "Đã hủy",
  no_show: "Vắng",
};

export function ShiftStatusBadge({ status, className }: { status: ShiftStatus; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold",
        STYLE[status] ?? STYLE.draft,
        className
      )}
    >
      {t(`dealer.shift.status.${status}`, FALLBACK[status] ?? status)}
    </span>
  );
}
