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

export interface LiveHubProps {
  title: string;
  clubName?: string | null;
  clubId?: string | null;
  subtitle?: string | null;
  onShare: () => void;
  /** The live table view (e.g. <TournamentLiveView/>). */
  children: ReactNode;
}

export function LiveHub({ title, clubName, clubId, subtitle, onShare, children }: LiveHubProps) {
  return (
    <div className="space-y-4">
      <LiveHubHeader
        title={title}
        clubName={clubName}
        clubId={clubId}
        subtitle={subtitle}
        onShare={onShare}
      />
      <FeaturedTableCard badge="TRỰC TIẾP • BÀN ĐANG DIỄN RA">{children}</FeaturedTableCard>
    </div>
  );
}
