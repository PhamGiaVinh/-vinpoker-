import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { WeekDayCell } from "@/types/dealerApp";

function dm(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function WeekShiftList({ cells }: { cells: WeekDayCell[] }) {
  const { t, i18n } = useTranslation();

  const pill = (c: WeekDayCell) => {
    if (c.kind === "off")
      return { text: t("dealer.week.off", "Off"), cls: "text-muted-foreground border-border bg-card" };
    if (c.kind === "leave")
      return { text: t("dealer.week.leave", "Nghỉ phép"), cls: "text-purple-400 border-purple-500/30 bg-purple-500/5" };
    if (c.kind === "on_call")
      return { text: t("dealer.week.onCall", "On-call"), cls: "text-blue-400 border-blue-500/30 bg-blue-500/5" };
    if (c.isNight || c.isOvernight)
      return { text: c.label, cls: "text-blue-400 border-blue-500/30 bg-blue-500/5" };
    return { text: c.label, cls: "text-primary border-primary/30 bg-primary/5" };
  };

  return (
    <div className="space-y-2">
      {cells.map((c) => {
        const wd = new Date(`${c.date}T00:00:00Z`).toLocaleDateString(i18n.language, {
          weekday: "short",
          timeZone: "UTC",
        });
        const p = pill(c);
        return (
          <div key={c.date} className="grid grid-cols-[52px_1fr] gap-2 items-stretch">
            <div
              className={cn(
                "rounded-xl grid place-items-center border py-1.5 leading-none",
                c.isToday ? "border-primary/50 text-primary" : "border-border bg-card text-foreground"
              )}
            >
              <span className="text-xs font-bold capitalize">{wd}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{dm(c.date)}</span>
            </div>
            <div className={cn("flex items-center px-3 rounded-xl border text-sm font-bold", p.cls)}>
              {p.text}
              {c.isToday && <span className="ml-auto text-[10px] font-medium opacity-80">{t("dealer.week.today", "Hôm nay")}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
