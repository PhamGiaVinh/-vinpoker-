// Spectator HAND FEED list — the primary "completed hands" block on the public
// viewer (RPT-Live "Updates" style). Reads completed hands via useCompletedHandsFeed
// (read-only), with tag filter chips + this-table/all-tables toggle + hand#/player
// search, and renders one HandFeedCard per hand, newest-first, with a "load more"
// pager. Presentational shell only; mounted behind FEATURES.liveHandFeed.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Search } from "lucide-react";
import { useCompletedHandsFeed } from "./useCompletedHandsFeed";
import { HandFeedCard } from "./HandFeedCard";
import type { HandFeedTag } from "./handFeedDerive";

export interface LiveHandFeedProps {
  tournamentId: string;
  /** Default the feed to the table the viewer is watching (null = all tables). */
  featuredTableId?: string | null;
  onViewHand?: (handNumber: number) => void;
  onShare?: (handNumber: number) => void;
}

const FILTER_TAGS: { tag: HandFeedTag; label: string; cls: string }[] = [
  { tag: "all_in", label: "ALL-IN", cls: "border-[#991B1B] bg-[#991B1B]/25 text-[#ff9b9b]" },
  { tag: "big_pot", label: "BIG POT", cls: "border-success/50 bg-success/15 text-success" },
  { tag: "high_hand", label: "HIGH HAND", cls: "border-warning/50 bg-warning/15 text-warning" },
  { tag: "eliminated", label: "ELIMINATED", cls: "border-destructive/50 bg-destructive/15 text-destructive" },
];

export function LiveHandFeed({ tournamentId, featuredTableId, onViewHand, onShare }: LiveHandFeedProps) {
  const { t } = useTranslation();
  const [tagFilter, setTagFilter] = useState<HandFeedTag[]>([]);
  const [allTables, setAllTables] = useState(false);
  const [search, setSearch] = useState("");

  const { items, loading, hasMore, loadMore } = useCompletedHandsFeed(tournamentId, {
    tableId: allTables ? null : featuredTableId ?? null,
    tags: tagFilter,
  });

  const toggleTag = (tag: HandFeedTag) =>
    setTagFilter((cur) => (cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag]));

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    const asNum = Number(q.replace(/[^0-9]/g, ""));
    return items.filter(
      (it) =>
        (Number.isFinite(asNum) && asNum > 0 && it.handNumber === asNum) ||
        it.players.some((p) => p.name.toLowerCase().includes(q)),
    );
  }, [items, search]);

  return (
    <div className="space-y-1.5">
      <div className="tracker-display flex items-center gap-1.5 px-0.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        {t("liveHub.handFeed.title", "Các ván đã xong")}
      </div>

      {/* filter chips + table scope */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTER_TAGS.map(({ tag, label, cls }) => {
          const active = tagFilter.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition ${
                active ? cls : "border-border/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`liveHub.handFeed.tag.${tag}`, label)}
            </button>
          );
        })}
        {featuredTableId && (
          <button
            type="button"
            onClick={() => setAllTables((v) => !v)}
            className={`ml-auto rounded-full border px-2.5 py-1 text-[10px] font-bold transition ${
              allTables ? "border-primary/50 bg-primary/15 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {allTables ? t("liveHub.handFeed.allTables", "Tất cả bàn") : t("liveHub.handFeed.thisTable", "Bàn này")}
          </button>
        )}
      </div>

      {/* search */}
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("liveHub.handFeed.search", "Tìm theo số ván hoặc tên người chơi…")}
          className="h-8 w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border/50 bg-card/50 py-6 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("liveHub.handFeed.loading", "Đang tải các ván…")}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card/50 px-3 py-6 text-center text-xs italic text-muted-foreground">
          {items.length === 0
            ? t("liveHub.handFeed.empty", "Chưa có ván nào hoàn tất")
            : t("liveHub.handFeed.noMatch", "Không có ván khớp bộ lọc")}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((item) => (
            <HandFeedCard key={item.handId} item={item} onViewHand={onViewHand} onShare={onShare} />
          ))}
          {hasMore && !search.trim() && (
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
