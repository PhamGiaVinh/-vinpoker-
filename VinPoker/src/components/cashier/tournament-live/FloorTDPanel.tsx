import { useState, Suspense, lazy } from "react";
import {
  Eye, Clock, LayoutGrid, Users, List, Trophy, ListOrdered, Tv,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Tournament } from "@/types/tournament";
import { ClockPanel } from "./ClockPanel";
import { TableDrawPanel } from "./TableDrawPanel";
import { PlayersListPanel } from "./PlayersListPanel";
import { BlindStructurePanel } from "./BlindStructurePanel";
import { PrizeStructurePanel } from "./PrizeStructurePanel";
import { TournamentLiveView } from "./TournamentLiveView";
import { RegistrationQueuePanel } from "./RegistrationQueuePanel";
import { TvDisplaysPanel } from "./TvDisplaysPanel";

// Existing self-contained ICM/deal calculator (also used in Documents.tsx) — reused
// here as the deal-making half of "Giải" (Payouts). Pure client math, no backend.
const ICMCalculator = lazy(() => import("@/components/gto/ICMCalculator"));

type FloorSub =
  | "status" | "clock" | "tables" | "players" | "levels" | "payouts" | "queue" | "tv";

const SUBS: { key: FloorSub; label: string; icon: typeof Eye }[] = [
  { key: "status", label: "Trạng thái", icon: Eye },
  { key: "clock", label: "Đồng hồ", icon: Clock },
  { key: "tables", label: "Bàn", icon: LayoutGrid },
  { key: "players", label: "Người chơi", icon: Users },
  { key: "levels", label: "Cấp / Mù", icon: List },
  { key: "payouts", label: "Giải thưởng", icon: Trophy },
  { key: "queue", label: "Hàng chờ", icon: ListOrdered },
  { key: "tv", label: "TV", icon: Tv },
];

/**
 * Kholdem-style Floor/TD console. One operator destination with a scrollable icon
 * sub-nav that composes the EXISTING tournament-live panels (no new backend). The
 * hand engine (HandInput / HandHistory) deliberately lives outside this — in the
 * separate "Live Tracker" tab — per the IA split.
 */
export function FloorTDPanel({
  tournament,
  refreshTrigger,
  tournaments,
}: {
  tournament: Tournament;
  refreshTrigger: number;
  tournaments: { id: string; name: string; club_id: string; status: string }[];
}) {
  const [sub, setSub] = useState<FloorSub>("status");
  const tid = tournament.id;

  return (
    <div className="space-y-4">
      {/* Kholdem-style icon sub-nav — scrollable, snap, neon active */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="inline-flex min-w-full gap-1 rounded-xl border border-border bg-card/60 p-1">
          {SUBS.map(({ key, label, icon: Icon }) => {
            const active = sub === key;
            return (
              <button
                key={key}
                onClick={() => setSub(key)}
                className={`flex min-w-[64px] flex-1 shrink-0 snap-start flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-primary/15 text-primary border border-primary/40"
                    : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="whitespace-nowrap">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content — render only the active sub-panel */}
      <div>
        {sub === "status" && <TournamentLiveView tournamentId={tid} />}
        {sub === "clock" && <ClockPanel tournamentId={tid} refreshTrigger={refreshTrigger} />}
        {sub === "tables" && <TableDrawPanel tournamentId={tid} refreshTrigger={refreshTrigger} />}
        {sub === "players" && <PlayersListPanel tournament={tournament} refreshTrigger={refreshTrigger} />}
        {sub === "levels" && <BlindStructurePanel tournamentId={tid} />}
        {sub === "payouts" && (
          <div className="space-y-4">
            <PrizeStructurePanel tournamentId={tid} />
            <Suspense fallback={<Skeleton className="h-40" />}>
              <ICMCalculator />
            </Suspense>
          </div>
        )}
        {sub === "queue" && (
          <RegistrationQueuePanel
            tournamentId={tid}
            tournamentName={tournament.name}
            tournamentDate={(tournament as Tournament & { start_time?: string | null }).start_time ?? null}
            refreshTrigger={refreshTrigger}
          />
        )}
        {sub === "tv" && (
          <TvDisplaysPanel
            tournamentId={tid}
            tournamentName={tournament.name}
            clubId={tournament.club_id}
            tournaments={tournaments}
          />
        )}
      </div>
    </div>
  );
}
