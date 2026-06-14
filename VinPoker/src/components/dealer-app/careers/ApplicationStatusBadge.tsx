import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { DEALER_GOLD } from "@/lib/dealerApp/constants";
import type { CareerApplicationStatus } from "@/types/dealerApp";

const STYLE: Record<CareerApplicationStatus, string> = {
  applied: "bg-[hsl(var(--ds-active)_/_0.12)] text-[hsl(var(--ds-active))] border-[hsl(var(--ds-active)_/_0.3)]",
  screening: "bg-warning/12 text-warning border-warning/30",
  interview: "bg-[hsl(var(--ds-preassign)_/_0.12)] text-[hsl(var(--ds-preassign))] border-[hsl(var(--ds-preassign)_/_0.3)]",
  offered: "", // gold via inline style
  hired: "bg-primary/15 text-primary border-primary/40",
  rejected: "bg-destructive/12 text-destructive border-destructive/30",
};

const FALLBACK: Record<CareerApplicationStatus, string> = {
  applied: "Đã nộp",
  screening: "Đang xét",
  interview: "Phỏng vấn",
  offered: "Đã mời",
  hired: "Trúng tuyển",
  rejected: "Từ chối",
};

export function ApplicationStatusBadge({ status }: { status: CareerApplicationStatus }) {
  const { t } = useTranslation();
  const gold = status === "offered";
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold", STYLE[status])}
      style={gold ? { color: DEALER_GOLD, borderColor: "rgba(230,184,76,0.4)", background: "rgba(230,184,76,0.1)" } : undefined}
    >
      {t(`dealer.careers.appStatus.${status}`, FALLBACK[status])}
    </span>
  );
}
