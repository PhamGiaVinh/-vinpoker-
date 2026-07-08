import { NavLink } from "react-router-dom";
import { Home, Timer, User, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";

type StaffTab = { to: string; end: boolean; icon: LucideIcon; label: string };

const BASE_TABS: StaffTab[] = [
  { to: "/staff", end: true, icon: Home, label: "Trang chủ" },
  { to: "/staff/attendance", end: false, icon: Timer, label: "Chấm công" },
  { to: "/staff/account", end: false, icon: User, label: "Tài khoản" },
];

const SALARY_TAB: StaffTab = { to: "/staff/salary", end: false, icon: Wallet, label: "Lương" };

export function StaffBottomNav() {
  const tabs = FEATURES.staffSelfSalary ? [BASE_TABS[0], BASE_TABS[1], SALARY_TAB, BASE_TABS[2]] : BASE_TABS;
  const colsClass = tabs.length === 4 ? "grid-cols-4" : "grid-cols-3";

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div className={cn("mx-auto grid h-[64px] max-w-md items-stretch", colsClass)}>
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn("flex items-center justify-center w-11 h-7 rounded-full transition-colors", isActive && "bg-primary/15")}>
                  <tab.icon className="w-5 h-5" />
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

