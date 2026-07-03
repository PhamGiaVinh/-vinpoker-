import { ShieldCheck, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import { MOCK_PAYROLL, MOCK_TABLE_HOUR } from "../mock/mockData";
import type { PayrollLineFixture } from "../mock/types";
import { DataStateBadge } from "../shared/DataStateBadge";
import { MoneyCard } from "../shared/MoneyCard";
import { TabShell } from "../shared/TabShell";

const sampleAlertChip = (
  <span className="mt-auto self-start text-[10px] font-semibold px-1.5 py-0.5 rounded border border-dashed border-amber-500/50 text-amber-400">
    Cảnh báo mẫu
  </span>
);

export function PayrollCostTab({
  lines = MOCK_PAYROLL,
  tableHour = MOCK_TABLE_HOUR,
}: {
  lines?: PayrollLineFixture[];
  tableHour?: typeof MOCK_TABLE_HOUR;
}) {
  return (
    <TabShell
      title="Lương & chi phí nhân sự"
      question="Tháng này chi phí người vận hành là bao nhiêu — và đã ghi nhận đủ chưa?"
      doctrine={[
        "Lương ghi nhận (chi phí) và lương đã trả (dòng tiền) là hai việc khác nhau — không bao giờ trộn lẫn.",
        "Dòng chi phí ĐÃ BIẾT là đang thiếu phải hiện cảnh báo kèm khoảng ước — không bao giờ hiện 0 ₫.",
      ]}
    >
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Lương được <span className="font-semibold text-foreground/90">GHI NHẬN khi làm việc</span> —
        ca xong là thành chi phí, kể cả khi chưa trả tiền. Việc{" "}
        <span className="font-semibold text-foreground/90">TRẢ tiền</span> là dòng tiền riêng — đối
        soát ở tab «Tiền &amp; Bank».
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {lines.map((line) =>
          line.missing ? (
            // Dòng thiếu (vd lương PT): viền amber + khoảng ước — MoneyCard tự render khoảng, không bao giờ ra "0 ₫".
            <div key={line.category} className="h-full [&>div]:border-amber-500/50">
              <MoneyCard
                label={line.label}
                amount={line.amount}
                state={line.state}
                kind="cost"
                sub={line.note}
                footer={sampleAlertChip}
              />
            </div>
          ) : (
            <MoneyCard
              key={line.category}
              label={line.label}
              amount={line.amount}
              state={line.state}
              kind="cost"
              sub={line.note}
            />
          ),
        )}
      </div>

      <Card className="p-3 md:p-4 border-[#378ADD]/30 bg-[#378ADD]/[0.04]">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-[#378ADD]" />
          <p className="text-[12px] leading-relaxed text-foreground/85">
            <span className="font-semibold text-[#378ADD]">Quy tắc cứng.</span> Lương đã lưu KHÔNG
            BAO GIỜ tính lại — thay đổi chính sách chỉ áp dụng về sau; sửa sai bằng bút toán điều
            chỉnh.
          </p>
        </div>
      </Card>

      <Card className="p-3 md:p-4 gradient-card">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Chi phí giờ-bàn
          </span>
          <DataStateBadge state="provisional" />
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-lg md:text-xl font-semibold tabular-nums text-foreground">
            ~{formatVND(tableHour.costPerTableHour)}/giờ
          </span>
          <span className="text-[12px] text-muted-foreground tabular-nums">
            ({formatVND(tableHour.staffCost)} / {tableHour.tableHours} giờ-bàn)
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Con số để ra quyết định — «thêm 1 ca dealer có đáng không?» — không phải KPI để khoe.
          Chưa gồm lương PT.
        </p>
        {tableHour.missingCheckouts > 0 && (
          <span className="mt-2 inline-flex w-fit items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-400 bg-amber-500/10">
            <TriangleAlert className="w-3 h-3 shrink-0" />
            {tableHour.missingCheckouts} dealer chưa check-out — giờ công chưa chốt được
          </span>
        )}
      </Card>
    </TabShell>
  );
}
