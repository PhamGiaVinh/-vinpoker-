import { NavLink } from "react-router-dom";
import { Home, Trophy, LayoutGrid, Bell, MoreHorizontal, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * OpsBottomNav — 5-tab bottom nav cho mobileOpsV2 (Hôm nay/Giải đấu/Bàn/Cảnh báo/Thêm).
 * Nhân bản pattern DealerBottomNav (safe-area, h-64, grid-cols-5, glow active). Không sửa file gốc.
 */
type OpsTab = { to: string; end: boolean; icon: LucideIcon; label: string; badge?: number };

const TABS: OpsTab[] = [
  { to: "/ops", end: true, icon: Home, label: "Hôm nay" },
  { to: "/ops/tournaments", end: false, icon: Trophy, label: "Giải đấu" },
  { to: "/ops/tables", end: false, icon: LayoutGrid, label: "Bàn" },
  { to: "/ops/alerts", end: false, icon: Bell, label: "Cảnh báo", badge: 4 },
  { to: "/ops/more", end: false, icon: MoreHorizontal, label: "Thêm" },
];

export function OpsBottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div className="mx-auto grid h-[64px] max-w-md grid-cols-5 items-stretch">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    "relative flex h-7 w-11 items-center justify-center rounded-full transition-colors",
                    isActive && "bg-primary/15",
                  )}
                >
                  <tab.icon
                    className={cn("h-5 w-5", isActive && "drop-shadow-[0_0_6px_hsl(var(--primary)/0.7)]")}
                  />
                  {tab.badge ? (
                    <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                      {tab.badge}
                    </span>
                  ) : null}
                </span>
                <span className="font-medium leading-tight">{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
