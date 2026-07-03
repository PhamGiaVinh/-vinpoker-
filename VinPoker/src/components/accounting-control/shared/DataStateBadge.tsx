import { Badge } from "@/components/ui/badge";
import { DATA_STATE_META, type DataState } from "../mock/types";

/**
 * Con dấu trạng thái dữ liệu — mọi con số tiền trên "Tài chính & Đối soát" phải mang đúng
 * một trong 4 trạng thái: Dự báo / Tạm tính / Đã đối soát / Đã chốt.
 */
export function DataStateBadge({ state, className = "" }: { state: DataState; className?: string }) {
  const meta = DATA_STATE_META[state];
  return (
    <Badge
      variant="outline"
      title={meta.description}
      className={`text-[10px] px-1.5 py-0 font-semibold tracking-wide ${meta.badgeClass} ${className}`}
    >
      {meta.label}
    </Badge>
  );
}
