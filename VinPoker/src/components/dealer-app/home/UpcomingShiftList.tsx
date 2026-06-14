import { useTranslation } from "react-i18next";
import { shiftTimeLabel } from "@/lib/dealerApp/selectors";
import { ShiftStatusBadge } from "../ShiftStatusBadge";
import type { DealerShiftView } from "@/types/dealerApp";

const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function dateChip(workDate: string): { wd: string; dm: string } {
  const d = new Date(`${workDate}T00:00:00Z`);
  return {
    wd: WD[d.getUTCDay()],
    dm: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
  };
}

/** Upcoming shifts (after today), max 3. */
export function UpcomingShiftList({ shifts, today }: { shifts: DealerShiftView[]; today: string }) {
  const { t } = useTranslation();
  const upcoming = shifts
    .filter((s) => s.workDate > today && s.status !== "cancelled" && s.status !== "no_show")
    .sort((a, b) => a.workDate.localeCompare(b.workDate))
    .slice(0, 3);

  if (upcoming.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="text-sm font-bold text-foreground mb-2">{t("dealer.home.upcoming", "Ca sắp tới")}</div>
      <div className="grid gap-2">
        {upcoming.map((s) => {
          const c = dateChip(s.workDate);
          return (
            <div key={s.id} className="flex items-center gap-3 bg-card border border-border rounded-xl p-3">
              <div className="w-12 h-12 rounded-lg bg-muted/50 grid place-items-center text-center leading-none">
                <span className="text-sm font-bold text-foreground">{c.wd}</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">{c.dm}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-foreground">{shiftTimeLabel(s)}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[s.gameType, s.tableName, s.role].filter(Boolean).join(" · ")}
                </div>
              </div>
              <ShiftStatusBadge status={s.status} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
