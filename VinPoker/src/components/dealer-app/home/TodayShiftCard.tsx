import { useTranslation } from "react-i18next";
import { Moon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { shiftTimeLabel, shiftHours, isOvernightShift } from "@/lib/dealerApp/selectors";
import { DEALER_GOLD } from "@/lib/dealerApp/constants";
import { ShiftStatusBadge } from "../ShiftStatusBadge";
import { ShiftActionButton } from "../ShiftActionButton";
import type { DealerShiftView } from "@/types/dealerApp";

/** Today's shift, gold-accented (hybrid Stitch), with a state-aware CTA. */
export function TodayShiftCard({ shift }: { shift: DealerShiftView }) {
  const { t } = useTranslation();
  const overnight = isOvernightShift(shift);
  const meta = [
    shift.gameType,
    shift.tableName,
    shift.role,
    [shift.venueName, shift.floorName].filter(Boolean).join(" · "),
  ].filter(Boolean) as string[];

  return (
    <Card className="border-[#E6B84C]/40 bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold tracking-wider" style={{ color: DEALER_GOLD }}>
          {t("dealer.home.todayShift", "CA HÔM NAY")}
        </span>
        <ShiftStatusBadge status={shift.status} />
      </div>
      <div className="flex items-end gap-2">
        <div className="text-2xl font-display font-black text-foreground">{shiftTimeLabel(shift)}</div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-xs text-muted-foreground">{shiftHours(shift)}h</span>
          {overnight && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[hsl(var(--ds-active))]">
              <Moon className="w-3 h-3" />
              {t("dealer.shift.overnight", "Qua đêm")}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {meta.map((m, i) => (
          <span key={i} className="text-[11px] text-foreground/80 bg-muted/60 rounded-md px-2 py-0.5">
            {m}
          </span>
        ))}
      </div>
      <ShiftActionButton shift={shift} className="mt-3" />
    </Card>
  );
}
