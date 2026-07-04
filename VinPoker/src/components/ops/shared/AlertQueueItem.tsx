import { ChevronRight } from "lucide-react";
import { OperationStatusChip, type OpStatus } from "./OperationStatusChip";

/**
 * AlertQueueItem — 1 dòng trong hàng đợi Cảnh báo/sự cố. docs/design/ios-operations-components.md §9.
 * Tài chính = read-only; hành động sửa mở luồng có xác nhận (mock: no-op).
 */
export function AlertQueueItem({
  icon,
  subject,
  detail,
  status,
  onTap,
}: {
  icon: string;
  subject: string;
  detail?: string;
  status: OpStatus;
  onTap?: () => void;
}) {
  return (
    <button onClick={onTap} className="flex w-full items-center gap-2.5 px-3 py-3 text-left">
      <span className="text-sm">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{subject}</span>
        {detail && <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>}
      </span>
      <OperationStatusChip status={status} />
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
