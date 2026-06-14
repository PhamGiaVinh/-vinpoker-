import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { computeCheckInState } from "@/lib/dealerApp/checkInWindow";
import { formatHm } from "@/lib/dealerApp/selectors";
import { CHECKIN_LATE_AFTER_MIN, DEALER_GOLD } from "@/lib/dealerApp/constants";
import { ShiftActionButton } from "../ShiftActionButton";
import type { DealerShiftView } from "@/types/dealerApp";

type Accent = "primary" | "warning" | "gold";

/** 4-step check-in progress + window info + state-aware action button. */
export function CheckInTimeline({ shift }: { shift: DealerShiftView }) {
  const { t } = useTranslation();
  const s = computeCheckInState(shift.status, shift.scheduledStartAt);
  const activeIndex = s.phase === "closed" ? 3 : s.phase === "checked_in" ? 2 : 0;
  const steps = [
    t("dealer.checkin.step0", "Chưa check-in"),
    t("dealer.checkin.step1", "Đã check-in"),
    t("dealer.checkin.step2", "Đang làm"),
    t("dealer.checkin.step3", "Kết thúc ca"),
  ];
  const latestOnTime = new Date(
    Date.parse(shift.scheduledStartAt) + CHECKIN_LATE_AFTER_MIN * 60_000
  ).toISOString();

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="grid grid-cols-4 gap-1 mb-2">
        {steps.map((_, i) => (
          <div key={i} className={cn("h-1 rounded-full", i <= activeIndex ? "bg-primary" : "bg-muted")} />
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1 mb-3">
        {steps.map((label, i) => (
          <div
            key={i}
            className={cn("text-[9px] text-center leading-tight", i === activeIndex ? "text-primary font-bold" : "text-muted-foreground")}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Info label={t("dealer.checkin.earliest", "Check-in mở")} value={formatHm(s.windowOpensAt)} accent="primary" />
        <Info label={t("dealer.checkin.latest", "Muộn nhất")} value={formatHm(latestOnTime)} accent="warning" />
        <Info label={t("dealer.checkin.table", "Bàn")} value={shift.tableName ?? "—"} accent="gold" />
      </div>
      <ShiftActionButton shift={shift} className="mt-3" />
    </div>
  );
}

function Info({ label, value, accent }: { label: string; value: string; accent: Accent }) {
  return (
    <div className="bg-background/40 border-t border-border rounded-lg p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={cn("text-sm font-bold", accent === "warning" ? "text-amber-400" : accent === "primary" ? "text-primary" : "")}
        style={accent === "gold" ? { color: DEALER_GOLD } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
