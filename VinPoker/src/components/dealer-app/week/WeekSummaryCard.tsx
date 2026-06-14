import { useTranslation } from "react-i18next";
import { Moon } from "lucide-react";
import type { WeekSummaryView } from "@/types/dealerApp";

export function WeekSummaryCard({ summary }: { summary: WeekSummaryView }) {
  const { t } = useTranslation();
  const pct = summary.targetHours > 0 ? Math.min(100, Math.round((summary.totalHours / summary.targetHours) * 100)) : 0;
  const remaining = Math.max(0, Math.round((summary.targetHours - summary.totalHours) * 10) / 10);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 mb-3">
      <div className="text-[13px] text-muted-foreground">{t("dealer.week.totalHours", "Tổng giờ tuần này")}</div>
      <div className="text-2xl font-display font-black text-foreground">
        {summary.totalHours}
        <span className="text-base text-muted-foreground"> / {summary.targetHours}h</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full mt-2 overflow-hidden">
        <div className="h-full gradient-neon rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
        <span>{t("dealer.week.remaining", "Còn {{h}}h để đạt mục tiêu", { h: remaining })}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-blue-400">
            <Moon className="w-3 h-3" />
            {summary.nightShifts}
          </span>
          <span>
            {summary.daysWorked} {t("dealer.week.daysShort", "ngày")}
          </span>
        </span>
      </div>
    </div>
  );
}
