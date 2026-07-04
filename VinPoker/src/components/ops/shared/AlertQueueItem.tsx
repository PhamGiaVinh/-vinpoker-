import { ChevronRight } from "lucide-react";
import { OperationStatusChip, type OpStatus } from "./OperationStatusChip";

/**
 * AlertQueueItem — 1 dòng trong hàng đợi Cảnh báo/sự cố (row iOS inset). docs/design/ios-operations-components.md §9.
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
    <button onClick={onTap} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/5 text-[15px]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] text-[#f2ece6]">{subject}</span>
        {detail && <span className="block truncate text-[13px] text-[#9b8e97]">{detail}</span>}
      </span>
      <OperationStatusChip status={status} />
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#5f545c]" />
    </button>
  );
}
