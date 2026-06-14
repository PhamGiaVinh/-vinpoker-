// Featured live-table card (Viewer Event Hub — Increment A). Premium casino card
// chrome (burgundy/gold) that frames the live table view passed as `children`.
// Presentational only — it does NOT render the felt itself; the caller passes the
// real <TournamentLiveView/> (which already reuses LiveFelt) so operator/live
// behaviour is untouched.

import type { ReactNode } from "react";

export interface FeaturedTableCardProps {
  /** Badge text in the card header, e.g. "TRỰC TIẾP • BÀN ĐANG DIỄN RA". */
  badge?: string;
  /** Optional status line on the right of the header. */
  statusLine?: string | null;
  /** The live table view (e.g. <TournamentLiveView/>). */
  children: ReactNode;
  /** Optional footer area (e.g. a "Xem tất cả bàn" CTA — wired in a later increment). */
  footer?: ReactNode;
}

export function FeaturedTableCard({
  badge = "TRỰC TIẾP",
  statusLine,
  children,
  footer,
}: FeaturedTableCardProps) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-card/60 overflow-hidden shadow-[0_0_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-gradient-to-r from-amber-500/10 to-transparent border-b border-amber-500/15">
        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300 uppercase tracking-wide min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="truncate">{badge}</span>
        </div>
        {statusLine && (
          <span className="text-[11px] text-muted-foreground truncate shrink-0">{statusLine}</span>
        )}
      </div>
      <div className="p-2 sm:p-3">{children}</div>
      {footer && (
        <div className="px-3.5 py-2.5 border-t border-border/40 bg-popover/60">{footer}</div>
      )}
    </div>
  );
}
