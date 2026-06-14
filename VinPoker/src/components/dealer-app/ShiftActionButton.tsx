import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LogIn, LogOut, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computeCheckInState } from "@/lib/dealerApp/checkInWindow";
import { formatHm } from "@/lib/dealerApp/selectors";
import type { DealerShiftView } from "@/types/dealerApp";

/**
 * State-aware confirm / check-in / check-out button shared by the home card and
 * the day check-in timeline. Inc 1: preview-only (toast). Inc 4 swaps the onClick
 * for the live dealer_* RPCs once Migration A is applied (flag-gated).
 */
export function ShiftActionButton({ shift, className }: { shift: DealerShiftView; className?: string }) {
  const { t } = useTranslation();
  const s = computeCheckInState(shift.status, shift.scheduledStartAt);

  const cta = (() => {
    if (s.canConfirm) return { label: t("dealer.action.confirm", "Xác nhận ca"), Icon: CheckCircle2, disabled: false };
    if (s.phase === "confirmed") {
      if (s.canCheckIn)
        return {
          label: s.isLate ? t("dealer.checkin.late", "Check-in muộn") : t("dealer.action.checkIn", "Check-in ngay"),
          Icon: LogIn,
          disabled: false,
        };
      return {
        label: t("dealer.checkin.opensAt", "Check-in mở lúc {{time}}", { time: formatHm(s.windowOpensAt) }),
        Icon: Clock,
        disabled: true,
      };
    }
    if (s.canCheckOut) return { label: t("dealer.action.checkOut", "Check-out"), Icon: LogOut, disabled: false };
    return { label: t("dealer.shift.status.closed", "Đã kết thúc"), Icon: CheckCircle2, disabled: true };
  })();

  return (
    <Button
      disabled={cta.disabled}
      onClick={() => toast.info(t("dealer.toast.previewOnly", "Bản xem trước — thao tác sẽ bật khi triển khai"))}
      className={cn(
        "w-full border-0 font-bold",
        cta.disabled ? "bg-muted text-muted-foreground hover:bg-muted" : "gradient-neon text-primary-foreground",
        className
      )}
    >
      <cta.Icon className="w-4 h-4 mr-1.5" />
      {cta.label}
    </Button>
  );
}
