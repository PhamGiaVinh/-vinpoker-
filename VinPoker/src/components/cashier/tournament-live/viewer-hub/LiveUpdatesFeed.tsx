// "Cập nhật • Trực tiếp" live updates feed (Viewer Event Hub — Increment B).
// Presentational only — rows derived from already-loaded hand actions (newest
// first). Badge colour by action kind; subdued casino palette.

import type { HubFeedItem, HubFeedKind } from "./hubDerive";

export interface LiveUpdatesFeedProps {
  feed: HubFeedItem[];
}

const KIND_BADGE: Record<HubFeedKind, { text: string; cls: string }> = {
  allin: { text: "ALL-IN", cls: "bg-red-500/15 text-red-300 border-red-500/40" },
  raise: { text: "TỐ", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  bet: { text: "CƯỢC", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  call: { text: "THEO", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" },
  check: { text: "CHECK", cls: "bg-secondary text-muted-foreground border-border/60" },
  fold: { text: "BỎ", cls: "bg-secondary text-muted-foreground border-border/60" },
  post: { text: "BLIND", cls: "bg-secondary text-muted-foreground border-border/60" },
  action: { text: "•", cls: "bg-secondary text-muted-foreground border-border/60" },
};

export function LiveUpdatesFeed({ feed }: LiveUpdatesFeedProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Cập nhật • Trực tiếp
      </div>
      <div className="rounded-xl border border-border/50 bg-card/50 divide-y divide-border/30 overflow-hidden">
        {feed.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center italic">
            Chưa có hành động nào trong ván hiện tại
          </div>
        ) : (
          feed.map((item) => {
            const badge = KIND_BADGE[item.kind] || KIND_BADGE.action;
            return (
              <div key={item.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${badge.cls}`}>
                  {badge.text}
                </span>
                <span className="text-muted-foreground shrink-0">Ghế {item.seatNumber}</span>
                <span className="font-semibold text-foreground truncate">{item.playerName}</span>
                <span className="ml-auto text-amber-200/80 font-mono truncate">{item.label}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
