import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDealerLink } from "@/hooks/dealer/useDealerLink";
import { useWeeklySchedule } from "@/hooks/dealer/useWeeklySchedule";
import { localTodayDate, addDays } from "@/lib/dealerApp/clock";
import { weekDates, buildWeekCells, weekSummary } from "@/lib/dealerApp/selectors";
import { WeekSummaryCard } from "./WeekSummaryCard";
import { WeekShiftList } from "./WeekShiftList";
import { RequestShiftDialog } from "../RequestShiftDialog";
import { DealerNotLinkedScreen } from "../DealerNotLinkedScreen";

function dm(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function WeeklyScheduleScreen() {
  const { t } = useTranslation();
  const { dealer, isDealer, loading } = useDealerLink();
  const today = localTodayDate();
  const [anchor, setAnchor] = useState(today);
  const [pickOpen, setPickOpen] = useState(false);
  const [pickDate, setPickDate] = useState<string | undefined>(undefined);
  const { data: shifts, isLoading } = useWeeklySchedule(dealer?.dealerId, anchor);

  if (loading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (!isDealer) return <DealerNotLinkedScreen />;

  const dates = weekDates(anchor);
  const cells = buildWeekCells(shifts ?? [], dates, today);
  const summary = weekSummary(shifts ?? [], anchor);
  const rangeLabel = `${dm(dates[0])} – ${dm(dates[6])}/${dates[6].slice(0, 4)}`;

  return (
    <div>
      <h1 className="text-xl font-display font-bold text-foreground mb-3">{t("dealer.week.title", "Lịch tuần")}</h1>

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setAnchor(addDays(anchor, -7))}
          aria-label="prev-week"
          className="w-9 h-9 grid place-items-center rounded-xl bg-card border border-border text-muted-foreground hover:text-primary"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center bg-card border border-primary/20 rounded-xl py-2.5 font-bold text-sm">
          {rangeLabel}
        </div>
        <button
          onClick={() => setAnchor(addDays(anchor, 7))}
          aria-label="next-week"
          className="w-9 h-9 grid place-items-center rounded-xl bg-card border border-border text-muted-foreground hover:text-primary"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <>
          <WeekSummaryCard summary={summary} />
          <WeekShiftList
            cells={cells}
            onPickDate={(d) => { setPickDate(d); setPickOpen(true); }}
          />
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#E6B84C]/30 bg-card p-3 text-[12px] text-muted-foreground">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-[#E6B84C]" />
            {t("dealer.week.hint", "Bấm vào một ngày để đăng ký ca mong muốn hoặc xin nghỉ.")}
          </div>
        </>
      )}
      <RequestShiftDialog
        dealerId={dealer?.dealerId}
        open={pickOpen}
        onOpenChange={setPickOpen}
        initialDate={pickDate}
      />
    </div>
  );
}
