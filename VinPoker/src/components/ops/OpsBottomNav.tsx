import { Link, useLocation } from "react-router-dom";
import { Bell, LayoutDashboard, Layers3, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type OpsTab = { to: string; icon: LucideIcon; label: string };

const HUB_TABS: readonly OpsTab[] = [
  { to: "/ops/select-module", icon: LayoutDashboard, label: "Tổng quan" },
  { to: "/ops/select-module?view=spaces", icon: Layers3, label: "Không gian" },
  { to: "/ops/alerts", icon: Bell, label: "Cảnh báo" },
  { to: "/ops/account", icon: UserRound, label: "Tài khoản" },
];

export function OpsBottomNav() {
  const location = useLocation();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-[#020403]/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid h-16 max-w-lg grid-cols-4">
        {HUB_TABS.map((tab) => {
          const [pathname, search = ""] = tab.to.split("?");
          const isActive = location.pathname === pathname
            && (search ? location.search === `?${search}` : !location.search);
          return (
          <Link
            key={tab.to}
            to={tab.to}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-300",
              isActive ? "text-emerald-300" : "text-[#91a49b]",
            )}
          >
            <tab.icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 2} />
            <span>{tab.label}</span>
          </Link>
          );
        })}
      </div>
    </nav>
  );
}
