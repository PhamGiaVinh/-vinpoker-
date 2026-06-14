// Public "Live Poker Event Hub" header (Viewer Event Hub — Increment A).
// Presentational only: premium live-event header (TRỰC TIẾP badge + title + club
// + share). Uses the existing VinPoker tracker visual language (emerald = live,
// amber/gold = premium). No data fetching, no logic.

import { Link } from "react-router-dom";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface LiveHubHeaderProps {
  title: string;
  clubName?: string | null;
  clubId?: string | null;
  /** Optional small subtitle (e.g. Main Event / level) when data exists. */
  subtitle?: string | null;
  /** Optional live-table count badge ("X bàn trực tiếp"); omitted when <= 0. */
  liveTableCount?: number;
  onShare: () => void;
}

export function LiveHubHeader({ title, clubName, clubId, subtitle, liveTableCount, onShare }: LiveHubHeaderProps) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 bg-emerald-500/15 text-emerald-400 rounded-md text-[11px] sm:text-xs font-bold border border-emerald-500/30 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          TRỰC TIẾP
          {liveTableCount != null && liveTableCount > 0 && (
            <span className="ml-1 text-emerald-300/90">· {liveTableCount} bàn</span>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="font-display font-bold text-base sm:text-lg leading-tight truncate">{title}</h1>
          {subtitle ? (
            <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
          ) : clubName && clubId ? (
            <Link
              to={`/club/${clubId}`}
              className="text-xs text-muted-foreground hover:text-emerald-400 transition-colors"
            >
              {clubName}
            </Link>
          ) : clubName ? (
            <div className="text-xs text-muted-foreground truncate">{clubName}</div>
          ) : null}
        </div>
      </div>
      <Button
        size="sm"
        onClick={onShare}
        className="bg-amber-500/90 hover:bg-amber-400 text-black font-bold shrink-0"
      >
        <Share2 className="w-3.5 h-3.5 mr-1.5" /> Chia sẻ
      </Button>
    </div>
  );
}
