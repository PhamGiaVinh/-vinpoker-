import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Calendar, Building2, User, MessageCircle, LogOut, TrendingUp, Sparkles, Trophy, BookOpen, Newspaper, Globe, Radio, Rss, QrCode, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadChats } from "@/hooks/useUnreadChats";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import { useAdminPendingCounts } from "@/hooks/useAdminPendingCounts";
import { DuplicateNameGuard } from "@/components/DuplicateNameGuard";
import { SupportFloatingButton } from "@/components/SupportFloatingButton";
import { InstallPWAButton } from "@/components/InstallPWAButton";
import { OpenInBrowserMenu } from "@/components/OpenInBrowserMenu";
import { MyQrSheet } from "@/components/MyQrSheet";
import { LogoFanButton } from "@/components/LogoFanButton";
import appLogo from "@/assets/app-logo.png";

const tabsData = [
  { to: "/", labelKey: "schedule", icon: Calendar, end: true, label: "Lịch giải" },
  { to: "/feed", labelKey: "feed", icon: Rss, label: "Bảng tin" },
  { to: "/clubs", labelKey: "clubs", icon: Building2, label: "CLB" },
  { to: "/news", labelKey: "news", icon: Newspaper, label: "Tin tức" },
  { to: "/international", labelKey: "international", icon: Globe, label: "Giải quốc tế" },
  { to: "/marketplace", labelKey: "marketplace", icon: Sparkles, label: " STAKE" },
  { to: "/find-backer", labelKey: "backer", icon: Sparkles, label: "Marketplace" },
  { to: "/documents", labelKey: "documents", icon: BookOpen, label: "Tài liệu" },
  { to: "/leaderboard", labelKey: "ranking", icon: Trophy, label: "Xếp hạng" },
  { to: "/account", labelKey: "account", icon: User, label: "Tài khoản" },
];

// Mobile bottom nav: 4 key public tabs + center LogoFanButton (no text overflow at 360px).
// Selected by route (stable against tabsData reordering); the rest stay reachable
// through the center quick-menu links below.
const MOBILE_TAB_ROUTES = ["/", "/feed", "/clubs", "/account"];
const mobileTabsData = MOBILE_TAB_ROUTES
  .map((to) => tabsData.find((t) => t.to === to))
  .filter((t): t is (typeof tabsData)[number] => Boolean(t));

// Destinations without a bottom-nav slot — exposed in the LogoFanButton quick menu
// so no previous mobile nav route becomes unreachable.
const mobileQuickLinks = tabsData.filter((t) => !MOBILE_TAB_ROUTES.includes(t.to));

export const Layout = () => {
  const [qrOpen, setQrOpen] = useState(false);
  const { t } = useTranslation();
  const { user, isAdmin, isClubAdmin, isCashier, isStaffOps, isMedia, isTracker, signOut } = useAuth();
  const { count: unreadCount } = useUnreadChats();
  const adminPending = useAdminPendingCounts();
  const location = useLocation();
  const nav = useNavigate();
  const hideShellOn = ["/auth"];
  const showShell = !hideShellOn.includes(location.pathname);

  if (!showShell) return <Outlet />;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/85 border-b border-border/60 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="mx-auto max-w-[1400px] flex items-center justify-between gap-4 px-6 h-16">
          <NavLink to="/" className="flex items-center gap-2 shrink-0">
            <img src={appLogo} alt={t("layout.logoAlt")} className="w-9 h-9 rounded-lg object-cover" />
            <div className="font-display font-black tracking-[0.18em] text-primary text-lg leading-none">
              VBacker
            </div>
          </NavLink>

          <nav className="hidden md:flex items-center gap-8">
            {tabsData.map((m) => (
              <NavLink
                key={m.to}
                to={m.to}
                end={m.end}
                className={({ isActive }) =>
                  cn(
                    "text-xs font-bold tracking-[0.18em] transition-colors relative py-1 uppercase",
                    isActive
                      ? "text-primary after:content-[''] after:absolute after:left-0 after:right-0 after:-bottom-1 after:h-0.5 after:bg-primary after:rounded-full after:shadow-neon"
                      : "text-muted-foreground hover:text-foreground"
                  )
                }
              >
                {t(`nav.${m.labelKey}`, m.label)}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <LanguageSwitcher />
            {user && <NotificationBell />}
            {user && (
              <NavLink
                to="/inbox"
                className="relative px-2.5 py-1.5 rounded-lg border border-border hover:border-primary/60 text-muted-foreground hover:text-primary inline-flex items-center gap-1.5 transition-colors"
                title={t("layout.inbox")}
              >
                <MessageCircle className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </NavLink>
            )}
            {user && <SupportFloatingButton />}

            {(isMedia || isAdmin) && (
              <NavLink
                to="/media"
                className="md:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-purple-500/40 text-purple-400 text-[11px] font-bold tracking-wider hover:bg-purple-500/15"
                title="Media Center"
              >
                <Sparkles className="w-3.5 h-3.5" />
                MEDIA
              </NavLink>
            )}

            {/* Mobile-only operator entry — /cashier guards itself; this is UI entry only */}
            {(isCashier || isAdmin) && (
              <NavLink
                to="/cashier"
                className="md:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/15 border border-primary/40 text-primary text-[11px] font-bold tracking-wider hover:bg-primary/25"
                title="Vận hành CLB — Cashier · Floor · Tracker · Swing"
              >
                <Wallet className="w-3.5 h-3.5" />
                VẬN HÀNH
              </NavLink>
            )}

            <div className="hidden md:flex items-center gap-1.5">
              {isClubAdmin && !isAdmin && (
                <NavLink to="/club/admin" className="px-2.5 py-1.5 rounded-lg border border-primary/30 text-primary text-[11px] font-semibold tracking-wider hover:bg-primary/10">
                  {t("layout.clubAdmin")}
                </NavLink>
              )}
              {isStaffOps && (
                <NavLink to="/admin/staking" className="relative px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground text-[11px] font-semibold tracking-wider hover:text-primary hover:border-primary/60">
                  {t("layout.staking")}
                  {adminPending.total > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                      {adminPending.total > 99 ? "99+" : adminPending.total}
                    </span>
                  )}
                </NavLink>
              )}
              {isCashier && !isAdmin && (
                <NavLink to="/cashier" className="px-2.5 py-1.5 rounded-lg bg-primary/15 border border-primary/40 text-primary text-[11px] font-bold tracking-wider hover:bg-primary/25">
                  {t("layout.cashier")}
                </NavLink>
              )}
              {isTracker && !isAdmin && (
                <NavLink to="/tracker" className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-[11px] font-bold tracking-wider hover:bg-emerald-500/25">
                  <Radio className="w-3 h-3 mr-1 inline" />TRACKER
                </NavLink>
              )}
              {isAdmin && (
                <>
                  <NavLink to="/admin/leaderboard" className="px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground text-[11px] font-semibold tracking-wider hover:text-primary hover:border-primary/60">
                    {t("layout.ranking")}
                  </NavLink>
                  <NavLink to="/admin" className="px-2.5 py-1.5 rounded-lg bg-primary/15 border border-primary/40 text-primary text-[11px] font-bold tracking-wider hover:bg-primary/25">
                    {t("layout.super")}
                  </NavLink>
                </>
              )}
              {(isMedia || isAdmin) && (
                <NavLink to="/media" className="px-2.5 py-1.5 rounded-lg border border-purple-500/40 text-purple-400 text-[11px] font-bold tracking-wider hover:bg-purple-500/15">
                  MEDIA
                </NavLink>
              )}
              {user && (
                <Button
                  onClick={() => setQrOpen(true)}
                  variant="outline"
                  size="sm"
                  className="text-[11px] font-bold tracking-wider px-2.5 py-1.5 h-auto border-primary/40 hover:bg-primary/10"
                  title="QR code"
                >
                  <QrCode className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            {user ? (
              <Button
                onClick={() => signOut()}
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive h-9"
                title={t("layout.signOut")}
              >
                <LogOut className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                onClick={() => nav("/auth")}
                className="gradient-neon text-primary-foreground border-0 font-bold tracking-wider rounded-full px-5 h-9 shadow-neon hover:opacity-90"
              >
                {t("nav.login")}
              </Button>
            )}

            <OpenInBrowserMenu />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-[1400px] px-4 md:px-6 py-6 pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:pb-8 animate-fade-in">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <DuplicateNameGuard />
      <InstallPWAButton />

      <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-xl md:hidden pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="mx-auto grid h-[68px] max-w-3xl grid-cols-5 items-stretch">
          {mobileTabsData.slice(0, 2).map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <tab.icon className={cn("w-5 h-5", isActive && "drop-shadow-[0_0_6px_hsl(var(--primary)/0.7)]")} />
                  <span className="font-medium">{t(`nav.${tab.labelKey}`, tab.label)}</span>
                </>
              )}
            </NavLink>
          ))}
          <LogoFanButton
            onQR={() => {
              if (user) setQrOpen(true);
              else nav("/auth");
            }}
            onPoker={() => nav("/")}
            quickLinks={mobileQuickLinks.map((tab) => ({
              to: tab.to,
              label: t(`nav.${tab.labelKey}`, tab.label),
            }))}
            onNavigate={(to) => nav(to)}
          />
          {mobileTabsData.slice(2).map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <tab.icon className={cn("w-5 h-5", isActive && "drop-shadow-[0_0_6px_hsl(var(--primary)/0.7)]")} />
                  <span className="font-medium">{t(`nav.${tab.labelKey}`, tab.label)}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {user && (
        <MyQrSheet
          open={qrOpen}
          onOpenChange={setQrOpen}
          userId={user.id}
          displayName={(user.user_metadata as any)?.display_name ?? user.email ?? null}
        />
      )}
    </div>
  );
};
