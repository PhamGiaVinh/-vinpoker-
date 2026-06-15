// Public "Live Poker Event Hub" stats bar (Viewer Event Hub).
// Presentational only — broadcast-style headline stats a spectator wants at a
// glance: prize pool, players remaining, and the current chip leader. Each tile
// is shown only when its data exists, and the whole bar collapses to nothing
// when there's nothing to show. Theme-aware via semantic + --poker-* tokens
// (works in dark + claude-warm). No data fetching, no logic.

import { Trophy, Users, Crown } from "lucide-react";
import { fmtCompact, type HubChipLeader } from "./hubDerive";

export interface LiveStatsBarProps {
  prizePool?: number | null;
  playersRemaining?: number | null;
  chipLeader?: HubChipLeader | null;
}

export function LiveStatsBar({ prizePool, playersRemaining, chipLeader }: LiveStatsBarProps) {
  const hasPrize = prizePool != null && prizePool > 0;
  const hasPlayers = playersRemaining != null && playersRemaining > 0;
  const hasLeader = !!chipLeader;

  // Nothing tracked yet → render nothing (no empty bar).
  if (!hasPrize && !hasPlayers && !hasLeader) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {hasPrize && (
        <div className="rounded-xl border border-border/50 bg-card/50 px-3 py-2.5 shadow-[0_0_18px_rgba(0,0,0,0.18)]">
          <div className="tracker-display flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Trophy className="h-3.5 w-3.5 text-warning" aria-hidden="true" /> Giải thưởng
          </div>
          <div className="tracker-num mt-0.5 text-lg font-bold leading-tight text-warning">
            {fmtCompact(prizePool!)}
          </div>
        </div>
      )}

      {hasPlayers && (
        <div className="rounded-xl border border-border/50 bg-card/50 px-3 py-2.5 shadow-[0_0_18px_rgba(0,0,0,0.18)]">
          <div className="tracker-display flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-success" aria-hidden="true" /> Còn lại
          </div>
          <div className="tracker-num mt-0.5 text-lg font-bold leading-tight text-foreground">
            {playersRemaining}
            <span className="ml-1 text-xs font-normal text-muted-foreground">người</span>
          </div>
        </div>
      )}

      {hasLeader && (
        <div className="col-span-2 rounded-xl border px-3 py-2.5 shadow-[0_0_18px_rgba(0,0,0,0.18)] sm:col-span-1"
          style={{ borderColor: "hsl(var(--poker-accent) / 0.4)", background: "hsl(var(--poker-accent) / 0.06)" }}>
          <div className="tracker-display flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <Crown className="h-3.5 w-3.5" aria-hidden="true" style={{ color: "hsl(var(--poker-accent))" }} /> Chip Leader
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="truncate text-sm font-bold text-foreground">{chipLeader!.playerName}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">Ghế {chipLeader!.seatNumber}</span>
          </div>
          <div className="tracker-num text-xs font-semibold" style={{ color: "hsl(var(--poker-accent))" }}>
            {fmtCompact(chipLeader!.chipCount)}
          </div>
        </div>
      )}
    </div>
  );
}
