import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { DEALER_GOLD } from "@/lib/dealerApp/constants";
import type { CareerApplicationStatus } from "@/types/dealerApp";

const STYLE: Record<CareerApplicationStatus, string> = {
  applied: "bg-blue-500/12 text-blue-400 border-blue-500/30",
  screening: "bg-amber-500/12 text-amber-400 border-amber-500/30",
  interview: "bg-purple-500/12 text-purple-400 border-purple-500/30",
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
