import { cn } from "@/lib/utils";
import type { MockDealer } from "../mock/opsData";

/**
 * DealerStatusCard — trạng thái 1 dealer/bàn (row iOS inset, read-only). docs/design/ios-operations-components.md §8.
 */
const STATE: Record<MockDealer["state"], { label: string; cls: string }> = {
  active: { label: "Đang bàn", cls: "bg-sky-400/12 text-sky-300" },
  rest: { label: "Nghỉ", cls: "bg-white/6 text-[#9b8e97]" },
  preassign: { label: "Sắp vào", cls: "bg-pink-400/12 text-pink-300" },
  missing: { label: "Thiếu", cls: "bg-rose-400/12 text-rose-300" },
};

export function DealerStatusCard({ d }: { d: MockDealer }) {
  const s = STATE[d.state];
  return (
    <div className="ios-row-inset flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] text-[#f2ece6]">
          {d.table ? `Bàn ${d.table} · ` : ""}
          {d.name ?? "—"}
        </span>
        <span className="block truncate text-[13px] text-[#9b8e97]">{d.info}</span>
      </span>
      <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", s.cls)}>{s.label}</span>
    </div>
  );
}
