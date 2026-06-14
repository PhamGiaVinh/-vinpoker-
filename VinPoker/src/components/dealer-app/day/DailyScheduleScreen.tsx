import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, CalendarX2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useDealerLink } from "@/hooks/dealer/useDealerLink";
import { useTodayShift } from "@/hooks/dealer/useTodayShift";
import { localTodayDate, addDays } from "@/lib/dealerApp/clock";
import { ShiftCard } from "./ShiftCard";
import { CheckInTimeline } from "./CheckInTimeline";
import { DealerNotLinkedScreen } from "../DealerNotLinkedScreen";

export function DailyScheduleScreen() {
  const { t, i18n } = useTranslation();
  const { dealer, isDealer, loading } = useDealerLink();
  const today = localTodayDate();
  const tomorrow = addDays(today, 1);
  const [date, setDate] = useState(today);
  const { data: shift, isLoading } = useTodayShift(dealer?.dealerId, date);

  if (loading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (!isDealer) return <DealerNotLinkedScreen />;

  const dateLabel = new Date(`${date}T00:00:00Z`).toLocaleDateString(i18n.language, {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div>
      <h1 className="text-xl font-display font-bold text-foreground mb-3">{t("dealer.day.title", "Lịch ngày")}</h1>

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setDate(addDays(date, -1))}
          aria-label="prev"
          className="w-9 h-9 grid place-items-center rounded-xl bg-card border border-border text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center bg-card border border-primary/20 rounded-xl py-2.5 font-bold text-sm capitalize">
          {dateLabel}
        </div>
        <button
          onClick={() => setDate(addDays(date, 1))}
          aria-label="next"
          className="w-9 h-9 grid place-items-center rounded-xl bg-card border border-border text-muted-foreground hover:text-primary"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 bg-card border border-border rounded-xl p-1 mb-4">
        <SegBtn active={date === today} onClick={() => setDate(today)} label={t("dealer.day.today", "Hôm nay")} />
        <SegBtn active={date === tomorrow} onClick={() => setDate(tomorrow)} label={t("dealer.day.tomorrow", "Ngày mai")} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : shift ? (
        <div className="space-y-3">
          <ShiftCard shift={shift} active />
          <div>
            <div className="text-sm font-bold text-foreground mb-2">{t("dealer.day.checkinStatus", "Trạng thái check-in")}</div>
            <CheckInTimeline shift={shift} />
          </div>
        </div>
      ) : (
        <Card className="p-8 flex flex-col items-center text-center gap-2 border-border">
          <CalendarX2 className="w-8 h-8 text-muted-foreground" />
          <div className="text-sm font-bold text-foreground">{t("dealer.day.noShifts", "Không có ca trong ngày này")}</div>
        </Card>
      )}
    </div>
  );
}

function SegBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "py-2 rounded-lg text-sm font-bold transition-colors",
        active ? "bg-primary/15 text-primary border border-primary/35" : "text-muted-foreground"
      )}
    >
      {label}
    </button>
  );
}
