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
  /** Optional header-right control (e.g. the orientation toggle). */
  headerAction?: ReactNode;
  /** Optional footer area (e.g. a "Xem tất cả bàn" CTA — wired in a later increment). */
  footer?: ReactNode;
}

export function FeaturedTableCard({
  badge = "TRỰC TIẾP",
  statusLine,
  children,
  headerAction,
  footer,
}: FeaturedTableCardProps) {
  return (
    <div
      className="rounded-2xl border bg-card/60 overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.35)] animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
      style={{ borderColor: "hsl(var(--poker-accent) / 0.3)" }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 sm:px-3.5 sm:py-2.5 border-b border-border"
        style={{ background: "linear-gradient(90deg, hsl(var(--poker-accent) / 0.12), transparent)" }}
      >
        <div className="tracker-display flex items-center gap-1.5 text-[11px] sm:text-xs font-bold text-warning uppercase tracking-wide min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="truncate">{badge}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {statusLine && (
            <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">{statusLine}</span>
          )}
          {headerAction}
        </div>
      </div>
      <div className="p-2 sm:p-3">{children}</div>
      {footer && (
        <div className="px-3.5 py-2.5 border-t border-border/40 bg-popover/60">{footer}</div>
      )}
    </div>
  );
}
