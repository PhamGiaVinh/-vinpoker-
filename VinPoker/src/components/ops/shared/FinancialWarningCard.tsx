import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { OperationStatusChip } from "./OperationStatusChip";
import type { MockFinLine } from "../mock/opsData";

/**
 * FinancialWarningCard — cảnh báo tài chính READ-ONLY, đúng doctrine, dạng grouped material iOS.
 * Floor KHÔNG sửa tiền. "Còn lại sau lương" (không "Lãi ròng") · "Tiền chuyển hộ/Nợ phải trả" (không
 * doanh thu) · badge Tạm tính/Đã chốt · nhãn DỮ LIỆU MẪU. docs/design/ios-operations-components.md §14.
 */
export function FinancialWarningCard({ lines }: { lines: MockFinLine[] }) {
  return (
    <div className="ios-group">
      {/* Nhãn "DỮ LIỆU MẪU" nội bộ đã GỠ — trang OpsAlerts (nơi duy nhất dùng card này) nay có
          MockChip ở header trang; 2 chip trên 1 màn = "lặp". */}
      <div className="ios-row-inset flex items-center justify-between gap-2 px-4 py-2.5">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Tài chính &amp; Đối soát</span>
      </div>
      {lines.map((l) => (
        <div key={l.label} className="ios-row-inset px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[15px] text-[#f2ece6]">{l.label}</span>
            <OperationStatusChip status={l.state === "final" ? "settled" : l.bad ? "reconcileError" : "provisional"} />
          </div>
          <div className={cn("mt-1 font-mono text-[18px] font-semibold", l.bad ? "text-rose-300" : "text-[#f2ece6]")}>
            {l.value}
            {l.passThrough && <span className="ml-2 text-[12px] font-normal text-[#9b8e97]">· Nợ phải trả</span>}
          </div>
          {l.note && <div className="text-[12px] italic text-[#9b8e97]">*{l.note}</div>}
        </div>
      ))}
      <div className="ios-row-inset flex items-center justify-center gap-1 px-4 py-2.5 text-[12px] text-[#7c7079]">
        <Lock className="h-3 w-3" /> Biên đóng góp ≠ Lợi nhuận · sửa trên máy tính
      </div>
    </div>
  );
}
