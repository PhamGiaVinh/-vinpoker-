import { RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SyncingBadgeProps {
  isFetching?: boolean;
  isError?: boolean;
  className?: string;
}

/**
 * Badge nhỏ hiển thị trạng thái đồng bộ dữ liệu khi đã có cache cũ.
 * - isFetching: hiển thị "Đang đồng bộ..." với icon xoay
 * - isError (và đã có data cũ): hiển thị "Mất kết nối · dùng dữ liệu cũ"
 */
export function SyncingBadge({ isFetching, isError, className }: SyncingBadgeProps) {
  if (!isFetching && !isError) return null;
  if (isError) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-warning/15 text-warning border border-warning/30 px-2 py-0.5 text-[10px] font-medium",
          className
        )}
        title="Không cập nhật được dữ liệu mới — đang hiển thị bản gần nhất"
      >
        <AlertTriangle className="w-3 h-3" /> Đang dùng dữ liệu cũ
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border border-border px-2 py-0.5 text-[10px] font-medium",
        className
      )}
    >
      <RefreshCw className="w-3 h-3 animate-spin" /> Đang đồng bộ...
    </span>
  );
}

export default SyncingBadge;
