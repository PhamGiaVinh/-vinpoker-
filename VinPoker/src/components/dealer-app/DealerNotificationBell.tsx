import { Bell } from "lucide-react";
import { useDealerLink } from "@/hooks/dealer/useDealerLink";
import { useWeeklySchedule } from "@/hooks/dealer/useWeeklySchedule";
import { localTodayDate } from "@/lib/dealerApp/clock";

/** Header bell. Phase-1 count is derived from this week's still-unconfirmed
 *  (published) shifts — no live event feed yet (dealer_shift_events has no
 *  dealer-self SELECT policy). React Query dedupes the week query with Home. */
export function DealerNotificationBell() {
  const { dealer } = useDealerLink();
  const today = localTodayDate();
  const { data: shifts } = useWeeklySchedule(dealer?.dealerId, today);
  const count = (shifts ?? []).filter((s) => s.status === "published").length;

  return (
    <button
      type="button"
      aria-label="Thông báo"
      className="relative w-9 h-9 grid place-items-center rounded-xl bg-card border border-border text-muted-foreground hover:text-primary transition-colors"
    >
      <Bell className="w-[18px] h-[18px]" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold grid place-items-center">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}
