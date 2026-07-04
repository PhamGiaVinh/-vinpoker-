import { cn } from "@/lib/utils";
import type { MockDealer } from "../mock/opsData";

/**
 * DealerStatusCard — trạng thái 1 dealer/bàn (read-only ở mobile). Token --ds-* có sẵn.
 * docs/design/ios-operations-components.md §8.
 */
const STATE: Record<MockDealer["state"], { label: string; cls: string }> = {
  active: { label: "Đang bàn", cls: "text-sky-400 border-sky-400/40 bg-sky-400/10" },
  rest: { label: "Nghỉ", cls: "text-muted-foreground border-border bg-muted/40" },
  preassign: { label: "Sắp vào", cls: "text-pink-400 border-pink-400/40 bg-pink-400/10" },
  missing: { label: "Thiếu", cls: "text-rose-400 border-rose-400/40 bg-rose-400/10" },
};

export function DealerStatusCard({ d }: { d: MockDealer }) {
  const s = STATE[d.state];
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">
          {d.table ? `Bàn ${d.table} · ` : ""}
          {d.name ?? "—"}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{d.info}</span>
      </span>
      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", s.cls)}>{s.label}</span>
    </div>
  );
}
