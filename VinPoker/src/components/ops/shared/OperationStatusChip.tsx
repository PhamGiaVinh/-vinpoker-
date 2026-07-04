import { cn } from "@/lib/utils";

/**
 * OperationStatusChip — 8 trạng thái vận hành, màu semantic (Midnight Sakura tokens + palette an toàn).
 * Kèm CHỮ (không chỉ dựa màu) cho accessibility. Xem docs/design/ios-operations-components.md §3.
 */
export type OpStatus =
  | "running"
  | "todo"
  | "late"
  | "noDealer"
  | "waitCashier"
  | "settled"
  | "provisional"
  | "reconcileError";

const MAP: Record<OpStatus, { label: string; cls: string }> = {
  running: { label: "Đang chạy", cls: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10" },
  todo: { label: "Cần xử lý", cls: "text-amber-400 border-amber-400/40 bg-amber-400/10" },
  late: { label: "Trễ giờ", cls: "text-rose-400 border-rose-400/40 bg-rose-400/10" },
  noDealer: { label: "Thiếu dealer", cls: "text-rose-400 border-rose-400/40 bg-rose-400/10" },
  waitCashier: { label: "Chờ cashier", cls: "text-pink-400 border-pink-400/40 bg-pink-400/10" },
  settled: { label: "Đã chốt", cls: "text-primary border-primary/40 bg-primary/10" },
  provisional: { label: "Tạm tính", cls: "text-muted-foreground border-border bg-muted/40" },
  reconcileError: { label: "Lỗi đối soát", cls: "text-rose-400 border-rose-400/40 bg-rose-400/10" },
};

export function OperationStatusChip({ status, className }: { status: OpStatus; className?: string }) {
  const m = MAP[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        m.cls,
        className,
      )}
    >
      {m.label}
    </span>
  );
}
