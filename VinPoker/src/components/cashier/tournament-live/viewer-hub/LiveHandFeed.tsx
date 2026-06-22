// Spectator HAND FEED list — the primary "completed hands" block on the public
// viewer (RPT-Live "Updates" style). Reads completed hands via useCompletedHandsFeed
// (read-only) and renders one HandFeedCard per hand, newest-first, with a "load more"
// pager. Presentational shell only; mounted behind FEATURES.liveHandFeed.

import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useCompletedHandsFeed } from "./useCompletedHandsFeed";
import { HandFeedCard } from "./HandFeedCard";

export interface LiveHandFeedProps {
  tournamentId: string;
  /** Default the feed to the table the viewer is watching (null = all tables). */
  featuredTableId?: string | null;
  onViewHand?: (handNumber: number) => void;
  onShare?: (handNumber: number) => void;
}

export function LiveHandFeed({ tournamentId, featuredTableId, onViewHand, onShare }: LiveHandFeedProps) {
  const { t } = useTranslation();
  const { items, loading, hasMore, loadMore } = useCompletedHandsFeed(tournamentId, {
    tableId: featuredTableId ?? null,
  });

  return (
    <div className="space-y-1.5">
      <div className="tracker-display flex items-center gap-1.5 px-0.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        {t("liveHub.handFeed.title", "Các ván đã xong")}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-card/50 py-6 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("liveHub.handFeed.loading", "Đang tải các ván…")}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card/50 px-3 py-6 text-center text-xs italic text-muted-foreground">
          {t("liveHub.handFeed.empty", "Chưa có ván nào hoàn tất")}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <HandFeedCard key={item.handId} item={item} onViewHand={onViewHand} onShare={onShare} />
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              className="w-full rounded-xl border border-border/60 bg-card/50 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
            >
              {t("liveHub.handFeed.more", "Xem thêm")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
