import { Receipt, ArrowRight } from "lucide-react";

/**
 * PlayerLookupCard — kết quả tra cứu 1 người chơi. SĐT masked; full money history chỉ owner/admin/self.
 * docs/design/ios-operations-components.md §7. Read-only mock.
 */
export function PlayerLookupCard({
  name,
  phone,
  status,
  place,
  entry,
}: {
  name: string;
  phone: string;
  status: string;
  place: string;
  entry: string;
}) {
  const busted = status === "Đã loại";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{phone}</span>
      </div>
      <div className="mt-0.5 text-xs">
        <span className={busted ? "text-muted-foreground" : "text-emerald-400"}>{status}</span>
        <span className="text-muted-foreground"> · {place}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">Lượt vào {entry}</div>
      <div className="mt-2 flex items-center gap-2">
        <button className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border bg-card py-1.5 text-xs">
          <ArrowRight className="h-3.5 w-3.5" /> Tới bàn
        </button>
        <button className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border bg-card py-1.5 text-xs">
          <Receipt className="h-3.5 w-3.5 text-sky-400" /> Phiếu
        </button>
      </div>
    </div>
  );
}
