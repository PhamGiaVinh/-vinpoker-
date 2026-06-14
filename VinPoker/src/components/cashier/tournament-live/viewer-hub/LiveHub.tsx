// Public "Live Poker Event Hub" shell (Viewer Event Hub — Increment A).
// Composes the hub header + a featured-table card around the live table view
// passed as `children`. Presentational only; the caller supplies tournament meta
// and the live view, so TournamentLiveView / LiveFelt / operator flow are
// untouched (zero data fetching here).
//
// Increment B (gated, separate PR) adds the data-driven pieces that need the
// viewer's internal state via a thin useLiveTrackerData hook: live-table count,
// all-tables strip, and the "Cập nhật • Trực tiếp" feed from loaded actions.

import type { ReactNode } from "react";
import { LiveHubHeader } from "./LiveHubHeader";
import { FeaturedTableCard } from "./FeaturedTableCard";
import { LiveTablesStrip } from "./LiveTablesStrip";
import { LiveUpdatesFeed } from "./LiveUpdatesFeed";
import { OrientationToggle } from "./OrientationToggle";
import { useLiveTrackerData } from "./useLiveTrackerData";

export interface LiveHubProps {
  tournamentId: string;
  title: string;
  clubName?: string | null;
  clubId?: string | null;
  subtitle?: string | null;
  onShare: () => void;
  /** The live table view (e.g. <TournamentLiveView/>). */
  children: ReactNode;
}

export function LiveHub({ tournamentId, title, clubName, clubId, subtitle, onShare, children }: LiveHubProps) {
  // Isolated hub data (count / all-tables strip / feed). Does NOT touch
  // TournamentLiveView — the featured felt below still renders the real viewer.
  const { liveTableCount, tables, feed } = useLiveTrackerData(tournamentId);
  return (
    <div className="space-y-3 sm:space-y-4 animate-in fade-in-0 duration-500 motion-reduce:animate-none">
      <LiveHubHeader
        title={title}
        clubName={clubName}
        clubId={clubId}
        subtitle={subtitle}
        liveTableCount={liveTableCount}
        onShare={onShare}
      />
      <FeaturedTableCard
        badge="TRỰC TIẾP • BÀN ĐANG DIỄN RA"
        headerAction={<OrientationToggle />}
      >
        {children}
      </FeaturedTableCard>
      <LiveTablesStrip tables={tables} />
      <LiveUpdatesFeed feed={feed} />
    </div>
  );
}
