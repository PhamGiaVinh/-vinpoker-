import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Spade } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDealerLink } from "@/hooks/dealer/useDealerLink";
import { FEATURES } from "@/lib/featureFlags";
import { RouteLoader } from "@/components/RouteLoader";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { DealerBottomNav } from "./DealerBottomNav";
import { DealerNotificationBell } from "./DealerNotificationBell";
import { DealerComingSoon } from "./DealerComingSoon";
import { DealerClubSwitcher } from "./DealerClubSwitcher";
import { DealerLogin } from "./DealerLogin";
import { BackButton } from "@/components/BackButton";

/**
 * Dealer Mobile App shell — its own 5-tab mobile chrome, separate from the main
 * player/operator Layout. Gating (in order):
 *  1. loading → RouteLoader
 *  2. live mode + not signed in → redirect /auth
 *  3. flag OFF + not admin/owner → DealerComingSoon (keeps the unreleased app dark)
 *  4. otherwise → render shell. Scheduling screens self-gate on the dealer link;
 *     Careers/Account stay reachable for un-linked users (open market).
 */
export default function DealerAppShell() {
  const { t } = useTranslation();
  const { user, isAdmin, isClubOwner, loading: authLoading } = useAuth();
  const { loading, source } = useDealerLink();

  const flagOn = FEATURES.dealerMobileApp;
  const allowPreview = isAdmin || isClubOwner;

  if (authLoading || loading) return <RouteLoader />;
  // Live mode + not signed in → the dealer-app login (account code + password the
  // Telegram bot sent, or the one-tap link), instead of the shared email login.
  if (source === "live" && !user) return <DealerLogin />;
  if (!flagOn && !allowPreview) return <DealerComingSoon />;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/85 border-b border-border/60 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="mx-auto w-full max-w-md flex items-center justify-between gap-2 px-4 h-14">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-card border border-primary/30 text-primary">
              <Spade className="w-5 h-5" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-display font-black tracking-[0.14em] text-primary">VBACKER</div>
              <div className="text-[11px] text-muted-foreground -mt-0.5">
                {t("dealer.appTagline", "Dealer · Cổng nhân viên")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <DealerClubSwitcher />
            <LanguageSwitcher />
            <DealerNotificationBell />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-md px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] animate-fade-in">
        <BackButton to="/" label={t("dealer.exitToMain", "Về app chính")} className="mb-2" />
        <Outlet />
      </main>

      <DealerBottomNav />
    </div>
  );
}
