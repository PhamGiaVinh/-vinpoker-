import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, CalendarDays, CalendarRange, Briefcase, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/dealer", end: true, icon: Home, key: "home", fallback: "Trang chủ" },
  { to: "/dealer/day", end: false, icon: CalendarDays, key: "day", fallback: "Lịch ngày" },
  { to: "/dealer/week", end: false, icon: CalendarRange, key: "week", fallback: "Lịch tuần" },
  { to: "/dealer/careers", end: false, icon: Briefcase, key: "careers", fallback: "Tuyển dụng" },
  { to: "/dealer/account", end: false, icon: User, key: "account", fallback: "Tài khoản" },
] as const;

export function DealerBottomNav() {
  const { t } = useTranslation();
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
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    "flex items-center justify-center w-11 h-7 rounded-full transition-colors",
                    isActive && "bg-primary/15"
                  )}
                >
                  <tab.icon className={cn("w-5 h-5", isActive && "drop-shadow-[0_0_6px_hsl(var(--primary)/0.7)]")} />
                </span>
                <span className="font-medium leading-tight">{t(`dealer.nav.${tab.key}`, tab.fallback)}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
