import { RefreshCw, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * RealtimeStaleBanner — báo số liệu realtime đã cũ / mất mạng; không bao giờ giả vờ số mới.
 * docs/design/ios-operations-components.md §13.
 */
export function RealtimeStaleBanner({
  lastUpdated,
  online = true,
  onRefresh,
}: {
  lastUpdated: string;
  online?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      className={cn(
        "flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px]",
        online
          ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
          : "border-rose-400/30 bg-rose-400/10 text-rose-300",
      )}
    >
      {online ? <RefreshCw className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {online ? `Cập nhật ${lastUpdated} · chạm để làm mới` : "Mất mạng — đang thử lại"}
    </button>
  );
}
