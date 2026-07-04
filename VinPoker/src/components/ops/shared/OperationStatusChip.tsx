import { cn } from "@/lib/utils";

/**
 * OperationStatusChip — 8 trạng thái vận hành dạng pill iOS mềm (fill tint, không viền cứng).
 * Kèm CHỮ (không chỉ dựa màu). docs/design/ios-operations-components.md §3.
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

const MAP: Record<OpStatus, { label: string; cls: string; dot: string }> = {
  running: { label: "Đang chạy", cls: "bg-emerald-400/12 text-emerald-300", dot: "bg-emerald-400" },
  todo: { label: "Cần xử lý", cls: "bg-amber-400/12 text-amber-300", dot: "bg-amber-400" },
  late: { label: "Trễ giờ", cls: "bg-rose-400/12 text-rose-300", dot: "bg-rose-400" },
  noDealer: { label: "Thiếu dealer", cls: "bg-rose-400/12 text-rose-300", dot: "bg-rose-400" },
  waitCashier: { label: "Chờ cashier", cls: "bg-pink-400/12 text-pink-300", dot: "bg-pink-400" },
  settled: { label: "Đã chốt", cls: "bg-[#c9a86a]/14 text-[#d8bc85]", dot: "bg-[#c9a86a]" },
  provisional: { label: "Tạm tính", cls: "bg-white/6 text-[#9b8e97]", dot: "bg-[#9b8e97]" },
  reconcileError: { label: "Lỗi đối soát", cls: "bg-rose-400/12 text-rose-300", dot: "bg-rose-400" },
};

export function OperationStatusChip({
  status,
  className,
  dot = false,
}: {
  status: OpStatus;
  className?: string;
  dot?: boolean;
}) {
  const m = MAP[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none",
        m.cls,
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />}
      {m.label}
    </span>
  );
}
