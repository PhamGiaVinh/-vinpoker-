import {
  ChevronLeft,
  LayoutGrid,
  Monitor,
  TimerReset,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { TournamentOpsTournament } from "@/ops/floor/TournamentOpsProvider";
import {
  FLOOR_WORKSPACE_TABS,
  floorTournamentPath,
  floorWorkspaceParentPath,
  type FloorWorkspaceTab,
} from "@/ops/floor/floorWorkspaceRoutes";

const tabIcons: Record<FloorWorkspaceTab, LucideIcon> = {
  tables: LayoutGrid,
  players: Users,
  clock: TimerReset,
  payout: Trophy,
  screens: Monitor,
};

export function TournamentContextRail({
  tournament,
}: {
  tournament: TournamentOpsTournament;
}) {
  return (
    <>
      <aside className="hidden min-w-0 md:block">
        <div className="sticky top-20 space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-4">
          <Link
            to={floorWorkspaceParentPath()}
            className="flex min-h-11 items-center gap-2 rounded-2xl px-3 text-sm text-[#b8c6bf] transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            <ChevronLeft className="h-4 w-4" />
            Thoát không gian giải
          </Link>
          <div className="border-y border-white/8 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">Giải đang vận hành</p>
            <h1 className="mt-1 break-words text-lg font-semibold text-white">{tournament.name}</h1>
            <p className="mt-1 text-xs text-[#91a49b]">
              {tournament.status} · {tournament.players_remaining ?? "—"} người còn lại
            </p>
          </div>
          <nav className="space-y-1" aria-label="Không gian giải đấu">
            {FLOOR_WORKSPACE_TABS.map((tab) => {
              const Icon = tabIcons[tab.key];
              return (
                <NavLink
                  key={tab.key}
                  to={floorTournamentPath(tournament.id, tab.key)}
                  className={({ isActive }) => cn(
                    "flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium transition",
                    isActive
                      ? "bg-emerald-300/15 text-emerald-200"
                      : "text-[#9eb0a7] hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-4 border-b border-white/8 bg-[#030604]/94 px-4 py-3 backdrop-blur-xl md:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to={floorWorkspaceParentPath()}
            className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 text-[#b8c6bf]"
            aria-label="Thoát không gian giải"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">{tournament.name}</p>
            <p className="truncate text-xs text-[#91a49b]">
              {tournament.status} · {tournament.players_remaining ?? "—"} người còn lại
            </p>
          </div>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/8 bg-[#020403]/96 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="grid h-16 grid-cols-5">
          {FLOOR_WORKSPACE_TABS.map((tab) => {
            const Icon = tabIcons[tab.key];
            return (
              <NavLink
                key={tab.key}
                to={floorTournamentPath(tournament.id, tab.key)}
                className={({ isActive }) => cn(
                  "flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium",
                  isActive ? "text-emerald-300" : "text-[#91a49b]",
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="max-w-full truncate">{tab.mobileLabel}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </>
  );
}
