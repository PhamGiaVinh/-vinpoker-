import { NavLink } from "react-router-dom";
import { Banknote, Grid3X3, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";

type OpsTab = { to: string; end: boolean; icon: LucideIcon; label: string };

export function OpsBottomNav() {
  const capabilities = useOpsCapabilities();
  const tabs: OpsTab[] = [
    ...(capabilities.hasFloorAccess
      ? [{ to: "/ops/floor", end: false, icon: Grid3X3, label: "Floor" }]
      : []),
    ...(capabilities.hasCashierAccess
      ? [{ to: "/ops/cashier", end: false, icon: Banknote, label: "Cashier" }]
      : []),
    { to: "/ops/account", end: true, icon: UserRound, label: "Tài khoản" },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-[#020403]/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid h-16 max-w-lg" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                "flex min-h-11 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                isActive ? "text-emerald-300" : "text-[#91a49b]",
              )
            }
          >
            {({ isActive }) => (
              <>
                <tab.icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 2} />
                <span>{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
