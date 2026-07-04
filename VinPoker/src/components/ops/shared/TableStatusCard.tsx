import { cn } from "@/lib/utils";
import type { MockTable } from "../mock/opsData";

/**
 * TableStatusCard — 1 bàn trong màn Bàn (lưới 2 cột @390), material iOS borderless + press.
 * docs/design/ios-operations-components.md §6. Read-only. Nhãn trạng thái bàn riêng (không dùng chip tài chính).
 */
const TABLE_STATE: Record<MockTable["status"], { label: string; cls: string }> = {
  running: { label: "Đang chạy", cls: "bg-emerald-400/12 text-emerald-300" },
  open: { label: "Trống", cls: "bg-white/6 text-[#9b8e97]" },
  paused: { label: "Tạm dừng", cls: "bg-amber-400/12 text-amber-300" },
  closed: { label: "Đóng", cls: "bg-white/6 text-[#9b8e97]" },
};

export function TableStatusCard({ table, onTap }: { table: MockTable; onTap?: () => void }) {
  const missingDealer = table.status === "running" || table.status === "paused" ? !table.dealer : false;
  const chip = table.needsFloor ? { label: "Cần xử lý", cls: "bg-amber-400/12 text-amber-300" } : TABLE_STATE[table.status];
  return (
    <button
      onClick={onTap}
      className={cn(
        "ios-press ios-card flex flex-col gap-1.5 p-3.5 text-left",
        table.needsFloor && "ring-1 ring-amber-400/30",
        missingDealer && "ring-1 ring-rose-400/30",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[16px] font-semibold text-[#f2ece6]">Bàn {table.tableNo}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none", chip.cls)}>{chip.label}</span>
      </div>
      <div className="font-mono text-[13px] text-[#9b8e97]">{table.occ}/{table.max} ghế</div>
      <div className={cn("text-[13px]", missingDealer ? "text-rose-300" : "text-[#9b8e97]")}>
        {table.status === "open" || table.status === "closed"
          ? "—"
          : table.dealer
            ? `Dealer · ${table.dealer}`
            : "Thiếu dealer"}
      </div>
    </button>
  );
}
