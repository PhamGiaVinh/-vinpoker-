import { cn } from "@/lib/utils";
import type { MockTable } from "../mock/opsData";

/**
 * TableStatusCard — 1 bàn trong màn Bàn (lưới 2 cột @390). Card ≥44px, KHÔNG lưới 3 cột chật (sửa P1 audit).
 * docs/design/ios-operations-components.md §6. Read-only. Trạng thái bàn có nhãn riêng (không dùng chip tài chính).
 */
const TABLE_STATE: Record<MockTable["status"], { label: string; cls: string }> = {
  running: { label: "Đang chạy", cls: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10" },
  open: { label: "Trống", cls: "text-muted-foreground border-border bg-muted/40" },
  paused: { label: "Tạm dừng", cls: "text-amber-400 border-amber-400/40 bg-amber-400/10" },
  closed: { label: "Đóng", cls: "text-muted-foreground border-border bg-muted/40" },
};

export function TableStatusCard({ table, onTap }: { table: MockTable; onTap?: () => void }) {
  const missingDealer = table.status === "running" || table.status === "paused" ? !table.dealer : false;
  const chip = table.needsFloor
    ? { label: "Cần xử lý", cls: "text-amber-400 border-amber-400/40 bg-amber-400/10" }
    : TABLE_STATE[table.status];
  return (
    <button
      onClick={onTap}
      className={cn(
        "flex flex-col gap-1 rounded-xl border bg-card p-3 text-left transition-colors",
        table.needsFloor ? "border-amber-400/50" : missingDealer ? "border-rose-400/50" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm font-semibold text-foreground">Bàn {table.tableNo}</span>
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none", chip.cls)}>
          {chip.label}
        </span>
      </div>
      <div className="font-mono text-xs text-muted-foreground">{table.occ}/{table.max} ghế</div>
      <div className={cn("text-xs", missingDealer ? "text-rose-400" : "text-muted-foreground")}>
        {table.status === "open" || table.status === "closed"
          ? "—"
          : table.dealer
            ? `Dealer: ${table.dealer}`
            : "Thiếu dealer"}
      </div>
    </button>
  );
}
