import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Calendar, Building2, User, MessageCircle, LogOut, TrendingUp, Sparkles, Trophy, BookOpen, Newspaper, Globe, Radio, Rss, QrCode, Wallet, Menu, LayoutGrid, Table2, Spade } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadChats } from "@/hooks/useUnreadChats";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import { useAdminPendingCounts } from "@/hooks/useAdminPendingCounts";
import { DuplicateNameGuard } from "@/components/DuplicateNameGuard";
import { SupportFloatingButton } from "@/components/SupportFloatingButton";
import { InstallPWAButton } from "@/components/InstallPWAButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
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
// Order: Lịch giải · Stake · [Logo] · Marketplace · Bảng tin (slice 0-2 before logo, 2- after).
// Selected by route (stable against tabsData reordering); the rest stay reachable
// through the header "☰" menu below so no previous mobile route becomes unreachable.
const MOBILE_TAB_ROUTES = ["/", "/marketplace", "/find-backer", "/feed"];
const mobileTabsData = MOBILE_TAB_ROUTES
  .map((to) => tabsData.find((t) => t.to === to))
  .filter((t): t is (typeof tabsData)[number] => Boolean(t));

// Mobile bottom-nav labels (owner-specified, i18n-driven). Desktop top nav keeps
// nav.marketplace / nav.backer; these override ONLY the bottom-nav pills.
const MOBILE_NAV_LABEL_KEY: Record<string, string> = {
  "/marketplace": "nav.mobileStake",
  "/find-backer": "nav.mobileBacker",
};

// Secondary routes without a bottom-nav slot — surfaced in the header "☰" menu
// (Tài khoản first; everything stays reachable, zero horizontal scroll).
const MOBILE_MENU_ROUTES = ["/account", "/clubs", "/news", "/international", "/documents", "/leaderboard"];
const mobileMenuData = MOBILE_MENU_ROUTES
  .map((to) => tabsData.find((t) => t.to === to))
  .filter((t): t is (typeof tabsData)[number] => Boolean(t));

export const Layout = () => {
  const [qrOpen, setQrOpen] = useState(false);
  const { t } = useTranslation();
  const { user, isAdmin, isClubAdmin, isClubOwner, isCashier, isStaffOps, isMedia, isTracker, isDealer, signOut } = useAuth();
  const { count: unreadCount } = useUnreadChats();
  const adminPending = useAdminPendingCounts();
  const location = useLocation();
  const nav = useNavigate();
  const hideShellOn = ["/auth"];
  const showShell = !hideShellOn.includes(location.pathname);

  if (!showShell) return <Outlet />;

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/85 border-b border-border/60 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="mx-auto max-w-[1400px] flex items-center justify-between gap-2 md:gap-4 px-3 md:px-6 h-16">
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Mobile "☰" secondary-nav menu — holds routes without a bottom-nav slot.
                On the left so the right action cluster never overflows at 360px. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-border text-muted-foreground hover:text-primary hover:border-primary/60 transition-colors"
                  aria-label="Menu"
                >
                  <Menu className="w-5 h-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>{t("layout.discover")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {mobileMenuData.map((m) => {
                  const active = location.pathname === m.to;
                  return (
                    <DropdownMenuItem
                      key={m.to}
                      onClick={() => nav(m.to)}
                      className={cn("gap-2.5 cursor-pointer", active && "text-primary")}
                    >
                      <m.icon className="w-4 h-4" />
                      {t(`nav.${m.labelKey}`, m.label)}
                    </DropdownMenuItem>
                  );
                })}
                {(isMedia || isAdmin) && (
                  <DropdownMenuItem
                    onClick={() => nav("/media")}
                    className={cn("gap-2.5 cursor-pointer", location.pathname === "/media" && "text-primary")}
                  >
                    <Sparkles className="w-4 h-4" />
                    Media Center
                  </DropdownMenuItem>
                )}
                {user && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => nav("/inbox")} className="gap-2.5 cursor-pointer">
                      <MessageCircle className="w-4 h-4" />
                      {t("layout.inbox", "Tin nhắn")}
                      {unreadCount > 0 && (
                        <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => signOut()}
                      className="gap-2.5 cursor-pointer text-destructive focus:text-destructive"
                    >
                      <LogOut className="w-4 h-4" />
                      {t("layout.signOut", "Đăng xuất")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <NavLink to="/" className="flex items-center gap-2 shrink-0">
              <img src={appLogo} alt={t("layout.logoAlt")} className="w-9 h-9 rounded-lg object-cover" />
              <div className="hidden sm:block font-display font-black tracking-[0.18em] text-primary text-lg leading-none">
                VBacker
              </div>
            </NavLink>
          </div>

          <nav className="hidden md:flex items-center gap-0.5">
            {tabsData.map((m) => (
              <NavLink
                key={m.to}
                to={m.to}
                end={m.end}
                className={({ isActive }) =>
                  cn(
                    "text-xs font-bold tracking-[0.1em] uppercase rounded-full px-2.5 py-1.5 whitespace-nowrap transition-colors",
                    isActive
                      ? "text-primary bg-primary/10 shadow-[0_0_10px_hsl(var(--primary)/0.2)]"
                      : "text-muted-foreground hover:text-foreground hover:bg-card/60"
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
                className="relative px-2.5 py-1.5 rounded-lg border border-border hover:border-primary/60 text-muted-foreground hover:text-primary hidden md:inline-flex items-center gap-1.5 transition-colors"
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
            {user && (
              <div className="hidden md:block">
                <SupportFloatingButton />
              </div>
            )}

            {/* Operator entry (mobile + desktop) — role-aware menu (TD + cashier + dealer).
                Each destination guards itself; this is a UI entry only. A pure dealer
                (no operator role) sees this menu with ONLY the Dealer App item. */}
            {(isCashier || isTracker || isAdmin || isClubAdmin || isClubOwner || isDealer) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1 min-h-[40px] md:min-h-0 px-2.5 py-2 md:py-1.5 rounded-lg bg-primary/20 border border-primary/50 text-primary text-[11px] font-bold tracking-wider hover:bg-primary/30 shadow-[0_0_10px_hsl(var(--primary)/0.35)] transition-colors"
                    aria-label={t("layout.operations")}
                  >
                    <Wallet className="w-[18px] h-[18px] md:w-4 md:h-4 shrink-0" />
                    <span className="hidden min-[400px]:inline">{t("layout.operationsShort")}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>{t("layout.operations")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(isTracker || isAdmin) && (
                    <DropdownMenuItem onClick={() => nav("/tracker")} className="gap-2.5 cursor-pointer">
                      <Radio className="w-4 h-4" />
                      Tracker
                    </DropdownMenuItem>
                  )}
                  {(isCashier || isAdmin) && (
                    <DropdownMenuItem onClick={() => nav("/cashier")} className="gap-2.5 cursor-pointer">
                      <Wallet className="w-4 h-4" />
                      Cashier
                    </DropdownMenuItem>
                  )}
                  {(isCashier || isAdmin) && (
                    <DropdownMenuItem onClick={() => nav("/floor")} className="gap-2.5 cursor-pointer">
                      <LayoutGrid className="w-4 h-4" />
                      Floor
                    </DropdownMenuItem>
                  )}
                  {(isCashier || isAdmin) && (
                    <DropdownMenuItem onClick={() => nav("/dealer-swing")} className="gap-2.5 cursor-pointer">
                      <Table2 className="w-4 h-4" />
                      Dealer Swing
                    </DropdownMenuItem>
                  )}
                  {(isClubAdmin || isClubOwner) && (
                    <DropdownMenuItem onClick={() => nav("/club/admin/finance")} className="gap-2.5 cursor-pointer">
                      <TrendingUp className="w-4 h-4" />
                      {t("layout.finance")}
                    </DropdownMenuItem>
                  )}
                  {/* Dealer App — shown to dealers (their only operator entry) and to
                      admins/owners. Operator items above stay role-gated, so a pure
                      dealer sees only this one. */}
                  {(isDealer || isAdmin || isClubOwner) && (
                    <DropdownMenuItem onClick={() => nav("/dealer")} className="gap-2.5 cursor-pointer">
                      <Spade className="w-4 h-4" />
                      Dealer App
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
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
              {/* Cashier/Tracker desktop entries moved into the unified VẬN HÀNH dropdown above. */}
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
                <NavLink to="/media" className="px-2.5 py-1.5 rounded-lg border border-[hsl(var(--ds-preassign)_/_0.4)] text-[hsl(var(--ds-preassign))] text-[11px] font-bold tracking-wider hover:bg-[hsl(var(--ds-preassign)_/_0.15)]">
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
                className="hidden md:flex text-muted-foreground hover:text-destructive h-9"
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

            <ThemeSwitcher />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-[1400px] px-4 md:px-6 py-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-8 animate-fade-in">
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
                  "flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn("flex items-center justify-center w-12 h-7 rounded-full transition-colors", isActive && "bg-primary/15")}>
                    <tab.icon className={cn("w-5 h-5", isActive && "drop-shadow-[0_0_6px_hsl(var(--primary)/0.7)]")} />
                  </span>
                  <span className="font-medium leading-tight text-center px-0.5 line-clamp-2">{MOBILE_NAV_LABEL_KEY[tab.to] ? t(MOBILE_NAV_LABEL_KEY[tab.to]) : t(`nav.${tab.labelKey}`, tab.label)}</span>
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
          />
          {mobileTabsData.slice(2).map((tab) => (
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
                  <span className={cn("flex items-center justify-center w-12 h-7 rounded-full transition-colors", isActive && "bg-primary/15")}>
                    <tab.icon className={cn("w-5 h-5", isActive && "drop-shadow-[0_0_6px_hsl(var(--primary)/0.7)]")} />
                  </span>
                  <span className="font-medium leading-tight text-center px-0.5 line-clamp-2">{MOBILE_NAV_LABEL_KEY[tab.to] ? t(MOBILE_NAV_LABEL_KEY[tab.to]) : t(`nav.${tab.labelKey}`, tab.label)}</span>
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
