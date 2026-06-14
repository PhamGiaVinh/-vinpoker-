import { useTranslation } from "react-i18next";
import { Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { shiftTimeLabel, shiftHours, isOvernightShift } from "@/lib/dealerApp/selectors";
import { ShiftStatusBadge } from "../ShiftStatusBadge";
import type { DealerShiftView } from "@/types/dealerApp";

/** One assignment row in the daily list. `active` highlights a confirmed /
 *  checked-in shift. Overnight (18–02 / 16–00) is badged via the tested core. */
export function ShiftCard({ shift, active }: { shift: DealerShiftView; active?: boolean }) {
  const { t } = useTranslation();
  const overnight = isOvernightShift(shift);
  const meta = [shift.gameType, shift.tableName, shift.role, shift.venueName].filter(Boolean) as string[];

  return (
    <div className={cn("rounded-2xl border p-4", active ? "border-primary/50 bg-primary/5" : "border-border bg-card")}>
      <div className="flex items-center justify-between">
        <div className="text-xl font-display font-bold text-foreground">{shiftTimeLabel(shift)}</div>
        <ShiftStatusBadge status={shift.status} />
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {meta.map((m, i) => (
          <span key={i} className="text-[11px] text-foreground/80 bg-muted/60 rounded-md px-2 py-0.5">
            {m}
          </span>
        ))}
      </div>
      {overnight && (
        <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-blue-400">
          <Moon className="w-3 h-3" />
          {t("dealer.shift.overnight", "Qua đêm")} · {shiftHours(shift)}h
        </div>
      )}
    </div>
  );
}
