import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CalendarDays, CalendarRange, CalendarOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEALER_GOLD } from "@/lib/dealerApp/constants";

export function QuickActionGrid() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const actions = [
    { Icon: CalendarDays, label: t("dealer.home.actionDay", "Lịch ngày"), gold: false, onClick: () => nav("/dealer/day") },
    { Icon: CalendarRange, label: t("dealer.home.actionWeek", "Lịch tuần"), gold: false, onClick: () => nav("/dealer/week") },
    {
      Icon: CalendarOff,
      label: t("dealer.action.requestLeave", "Xin nghỉ"),
      gold: true,
      onClick: () => toast.info(t("dealer.toast.previewOnly", "Bản xem trước — thao tác sẽ bật khi triển khai")),
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={a.onClick}
          className="h-[58px] rounded-xl bg-card border border-border flex flex-col items-center justify-center gap-1 hover:border-primary/40 transition-colors"
        >
          <a.Icon className={cn("w-5 h-5", !a.gold && "text-primary")} style={a.gold ? { color: DEALER_GOLD } : undefined} />
          <span className="text-[10px] text-muted-foreground">{a.label}</span>
        </button>
      ))}
    </div>
  );
}
