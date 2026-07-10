import { NavLink } from "react-router-dom";
import { CalendarDays, Trophy, LayoutGrid, Bell, Menu, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * OpsBottomNav — frosted native-iOS tab bar cho mobileOpsV2 (Hôm nay/Giải đấu/Bàn/Cảnh báo/Thêm).
 * Translucent material, neon active tint, hairline top edge. docs/design/ios-operations-components.md §2.
 */
type OpsTab = { to: string; end: boolean; icon: LucideIcon; label: string; badge?: number };

const TABS: OpsTab[] = [
  { to: "/ops", end: true, icon: CalendarDays, label: "Hôm nay" },
  { to: "/ops/tournaments", end: false, icon: Trophy, label: "Giải đấu" },
  { to: "/ops/tables", end: false, icon: LayoutGrid, label: "Bàn" },
  { to: "/ops/alerts", end: false, icon: Bell, label: "Cảnh báo", badge: 4 },
  { to: "/ops/more", end: false, icon: Menu, label: "Thêm" },
];

export function OpsBottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 ios-blur bg-[#020403]/88 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/8" />
      <div className="mx-auto grid h-[58px] max-w-md grid-cols-5 items-stretch">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                "ios-press-sm flex flex-col items-center justify-center gap-1 pt-1 text-[10px] font-medium transition-colors",
                isActive ? "text-[#00ff88]" : "text-[#91a49b]",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative">
                  <tab.icon
                    className="h-[23px] w-[23px]"
                    strokeWidth={isActive ? 2.4 : 2}
                    style={isActive ? { filter: "drop-shadow(0 0 8px rgba(0,255,136,0.65))" } : undefined}
                  />
                  {tab.badge ? (
                    <span className="absolute -right-2 -top-1.5 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#e2718f] px-1 text-[9px] font-bold text-white shadow-[0_2px_6px_-1px_rgba(226,113,143,0.7)]">
                      {tab.badge}
                    </span>
                  ) : null}
                </span>
                <span className="leading-none tracking-tight">{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
