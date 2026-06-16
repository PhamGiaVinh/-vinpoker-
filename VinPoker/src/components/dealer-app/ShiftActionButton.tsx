import { useTranslation } from "react-i18next";
import { LogIn, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computeCheckInState } from "@/lib/dealerApp/checkInWindow";
import { formatHm, poolEntryInfo } from "@/lib/dealerApp/selectors";
import { useShiftActions, type ShiftAction } from "@/hooks/dealer/useShiftActions";
import { FEATURES } from "@/lib/featureFlags";
import type { DealerShiftView } from "@/types/dealerApp";

/**
 * State-aware confirm / check-in button shared by the home card and the day
 * check-in timeline. Wired to the dealer self-service RPCs via useShiftActions.
 * Dealers can CONFIRM + CHECK-IN only — self CHECK-OUT is disabled (owner rule:
 * only dealer-control / floor may check a dealer out, via the Dealer Swing panel,
 * which also DMs the dealer). Roster-only; never the live swing system.
 */
export function ShiftActionButton({ shift, className }: { shift: DealerShiftView; className?: string }) {
  const { t } = useTranslation();
  const s = computeCheckInState(shift.status, shift.scheduledStartAt);
  const { confirm, checkIn, isPending } = useShiftActions();

  const cta = (() => {
    if (s.canConfirm)
      return { label: t("dealer.action.confirm", "Xác nhận ca"), Icon: CheckCircle2, disabled: false, action: "confirm" as ShiftAction };
    if (s.phase === "confirmed") {
      if (s.canCheckIn)
        return {
          label: s.isLate ? t("dealer.checkin.late", "Check-in muộn") : t("dealer.action.checkIn", "Check-in ngay"),
          Icon: LogIn,
          disabled: false,
          action: "checkIn" as ShiftAction,
        };
      return {
        label: t("dealer.checkin.opensAt", "Check-in mở lúc {{time}}", { time: formatHm(s.windowOpensAt) }),
        Icon: Clock,
        disabled: true,
        action: null,
      };
    }
    // Checked in → dealers do NOT self check-out; floor/DC handles it.
    if (s.canCheckOut)
      return {
        label: t("dealer.checkin.inShiftDcCheckout", "Đang trong ca — DC sẽ check-out"),
        Icon: CheckCircle2,
        disabled: true,
        action: null,
      };
    return { label: t("dealer.shift.status.closed", "Đã kết thúc"), Icon: CheckCircle2, disabled: true, action: null };
  })();

  const onClick = () => {
    if (!cta.action || isPending) return;
    if (cta.action === "confirm") void confirm(shift);
    else if (cta.action === "checkIn") void checkIn(shift);
  };

  // Scheduled-pool note (flag-gated): after check-in, show "pending until HH:MM"
  // (early arrival) or "in pool" (scheduled start reached). Computed from the
  // assignment alone — no dealer_attendance read in the dealer app.
  const pool = FEATURES.dealerPoolBridge && shift.status === "checked_in"
    ? poolEntryInfo(shift, new Date().toISOString())
    : null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Button
        disabled={cta.disabled || isPending}
        onClick={onClick}
        className={cn(
          "w-full border-0 font-bold",
          cta.disabled ? "bg-muted text-muted-foreground hover:bg-muted" : "gradient-neon text-primary-foreground"
        )}
      >
        {isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <cta.Icon className="w-4 h-4 mr-1.5" />}
        {cta.label}
      </Button>
      {pool && (
        <p className="text-[12px] text-center text-muted-foreground">
          {pool.pending
            ? t("dealer.pool.pendingBadge", "⏳ Đã có mặt · vào pool lúc {{time}}", { time: formatHm(pool.poolEntryAt) })
            : t("dealer.pool.inPool", "🟢 Đang trong pool xoay dealer")}
        </p>
      )}
    </div>
  );
}
