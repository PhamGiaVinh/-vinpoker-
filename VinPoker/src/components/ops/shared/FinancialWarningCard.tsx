import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { OperationStatusChip } from "./OperationStatusChip";
import type { MockFinLine } from "../mock/opsData";

/**
 * FinancialWarningCard — cảnh báo tài chính READ-ONLY, đúng doctrine. Floor KHÔNG sửa tiền.
 * "Còn lại sau lương" (không "Lãi ròng") · "Tiền chuyển hộ"/"Nợ phải trả" (không doanh thu) ·
 * badge Tạm tính/Đã chốt · nhãn DỮ LIỆU MẪU. docs/design/ios-operations-components.md §14.
 */
export function FinancialWarningCard({ lines }: { lines: MockFinLine[] }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Tài chính &amp; Đối soát
        </span>
        <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
          DỮ LIỆU MẪU
        </span>
      </div>
      <div className="divide-y divide-border">
        {lines.map((l) => (
          <div key={l.label} className="px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-foreground">{l.label}</span>
              <OperationStatusChip status={l.state === "final" ? "settled" : l.bad ? "reconcileError" : "provisional"} />
            </div>
            <div className={cn("mt-0.5 font-mono text-base", l.bad ? "text-rose-400" : "text-foreground")}>
              {l.value}
              {l.passThrough && <span className="ml-2 text-[11px] text-muted-foreground">· Nợ phải trả</span>}
            </div>
            {l.note && <div className="text-[11px] italic text-muted-foreground">*{l.note}</div>}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-1 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <Lock className="h-3 w-3" /> Biên đóng góp ≠ Lợi nhuận · sửa trên máy tính
      </div>
    </div>
  );
}
