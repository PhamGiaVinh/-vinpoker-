import { Card } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import { DataStateBadge } from "./DataStateBadge";
import type { DataState } from "../mock/types";

/**
 * Thẻ TIỀN GIỮ HỘ / KHOẢN PHẢI TRẢ — pass-through và liability KHÔNG BAO GIỜ mang màu
 * doanh thu (xanh primary). Viền + chữ ánh vàng "chip trong lồng két" để chủ CLB nhận ra
 * ngay đây là tiền của người khác đang nằm trong club.
 */
export function LiabilityCard({
  label,
  amount,
  state,
  note,
}: {
  label: string;
  amount: number;
  state: DataState;
  note?: string;
}) {
  return (
    <Card className="p-3 md:p-4 h-full flex flex-col gap-1.5 border-[#d4b46a]/30 bg-[#d4b46a]/[0.04]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-[#d4b46a]/80">
          Tiền giữ hộ · khoản phải trả
        </span>
        <DataStateBadge state={state} />
      </div>
      <span className="text-[12px] text-foreground/90">{label}</span>
      <div className="text-lg md:text-xl font-semibold tabular-nums text-[#d4b46a]">{formatVND(amount)}</div>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </Card>
  );
}
