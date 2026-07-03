import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import { DataStateBadge } from "./DataStateBadge";
import type { DataState, RangeForecast } from "../mock/types";

type MoneyCardKind = "revenue" | "cost" | "neutral";

/** Chỉ tiền CLB THỰC GIỮ mới được ánh xanh primary; số âm luôn đỏ; còn lại trung tính. */
const kindClass = (kind: MoneyCardKind, amount: number | RangeForecast): string => {
  if (typeof amount === "number" && amount < 0) return "text-red-400";
  if (kind === "revenue") return "text-primary";
  if (kind === "cost") return "text-[#f0997b]";
  return "text-foreground";
};

export const formatRange = (r: RangeForecast) =>
  `${formatVND(r.min)} – ${formatVND(r.max)} (thường gặp ~${formatVND(r.typical)})`;

/**
 * Thẻ KPI tiền cho chủ CLB: nhãn thường-ngữ + con dấu trạng thái + giá trị.
 * Dự báo bắt buộc là khoảng (RangeForecast) — không nhận số điểm cho state "forecast".
 */
export function MoneyCard({
  label,
  amount,
  state,
  kind = "neutral",
  sub,
  footer,
}: {
  label: string;
  amount: number | RangeForecast;
  state: DataState;
  kind?: MoneyCardKind;
  sub?: string;
  footer?: ReactNode;
}) {
  const isRange = typeof amount !== "number";
  return (
    <Card className="p-3 md:p-4 gradient-card h-full flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <DataStateBadge state={state} />
      </div>
      <div className={`font-semibold tabular-nums ${isRange ? "text-sm md:text-base" : "text-lg md:text-xl"} ${kindClass(kind, amount)}`}>
        {isRange ? formatRange(amount) : formatVND(amount)}
      </div>
      {isRange && (
        <p className="text-[10px] text-muted-foreground">Khoảng dự báo — không phải con số chắc chắn. {amount.baselineNote}.</p>
      )}
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      {footer}
    </Card>
  );
}
