// Public "Live Poker Event Hub" shell (Viewer Event Hub — Increment A).
// Composes the hub header + a featured-table card around the live table view
// passed as `children`. Presentational only; the caller supplies tournament meta
// and the live view, so TournamentLiveView / LiveFelt / operator flow are
// untouched (zero data fetching here).
//
// Increment B (gated, separate PR) adds the data-driven pieces that need the
// viewer's internal state via a thin useLiveTrackerData hook: live-table count,
// all-tables strip, and the "Cập nhật • Trực tiếp" feed from loaded actions.

import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LiveHubHeader } from "./LiveHubHeader";
import { LiveStatsBar } from "./LiveStatsBar";
import { FeaturedTableCard } from "./FeaturedTableCard";
import { LiveTablesStrip } from "./LiveTablesStrip";
import { LiveUpdatesFeed } from "./LiveUpdatesFeed";
import { OrientationToggle } from "./OrientationToggle";
import { useLiveTrackerData } from "./useLiveTrackerData";
import { useIsMobile } from "@/hooks/use-mobile";

type Orientation = "landscape" | "portrait";

export interface LiveHubProps {
  tournamentId: string;
  title: string;
  clubName?: string | null;
  clubId?: string | null;
  subtitle?: string | null;
  /** Tournament prize pool (VND) — from `tournaments.prize_pool`; null when unset. */
  prizePool?: number | null;
  /** Players still alive — from `tournaments.players_remaining`; null when unset. */
  playersRemaining?: number | null;
  onShare: () => void;
  /** The live table view (e.g. <TournamentLiveView/>). */
  children: ReactNode;
}

export function LiveHub({ tournamentId, title, clubName, clubId, subtitle, prizePool, playersRemaining, onShare, children }: LiveHubProps) {
  // Isolated hub data (count / all-tables strip / feed / chip leader). Does NOT
  // touch TournamentLiveView — the featured felt below still renders the real viewer.
  const { liveTableCount, tables, feed, chipLeader } = useLiveTrackerData(tournamentId);
  const { t } = useTranslation();

  // Orientation: default to the device (portrait on phones, landscape on desktop),
  // but let the viewer flip Ngang/Dọc on EITHER device via the header toggle.
  const isMobile = useIsMobile();
  const [orientation, setOrientation] = useState<Orientation | null>(null);
  const effectiveOrientation: Orientation = orientation ?? (isMobile ? "portrait" : "landscape");

  // Inject the orientation as a presentational override into the child viewer
  // (the real <TournamentLiveView/>). Additive prop only — no data-path change.
  // Guard: only inject into component children (function/class), never a host DOM
  // element, so the prop can't leak onto a <div> and trigger a React warning.
  const viewer =
    isValidElement(children) && typeof children.type !== "string"
      ? cloneElement(children as ReactElement<{ orientationOverride?: Orientation }>, {
          orientationOverride: effectiveOrientation,
        })
      : children;

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
      <LiveStatsBar prizePool={prizePool} playersRemaining={playersRemaining} chipLeader={chipLeader} />
      <FeaturedTableCard
        badge={t("liveHub.featured.badge", "TRỰC TIẾP • BÀN ĐANG DIỄN RA")}
        headerAction={<OrientationToggle value={effectiveOrientation} onChange={setOrientation} />}
      >
        {viewer}
      </FeaturedTableCard>
      <LiveTablesStrip tables={tables} />
      <LiveUpdatesFeed feed={feed} />
    </div>
  );
}
