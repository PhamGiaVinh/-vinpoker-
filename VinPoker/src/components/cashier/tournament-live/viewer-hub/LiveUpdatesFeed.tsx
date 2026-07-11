// "Cập nhật • Trực tiếp" live updates feed (Viewer Event Hub). Presentational
// only — rows derived from already-loaded hand actions (newest first). Each row =
// kind icon + player line + action label + kind tag. Theme-aware via semantic
// tokens (works in dark + claude-warm). No invented data (no fake timestamps).

import { useTranslation } from "react-i18next";
import { Flame, TrendingUp, Coins, ArrowRightLeft, Minus, X, Circle, type LucideIcon } from "lucide-react";
import { fmtCompact, type HubFeedItem, type HubFeedKind } from "./hubDerive";

export interface LiveUpdatesFeedProps {
  feed: HubFeedItem[];
  /** Compact, horizontally scrollable current-hand rail for the RPT shell. */
  rpt?: boolean;
}

const KIND_META: Record<HubFeedKind, { text: string; cls: string; Icon: LucideIcon }> = {
  allin: { text: "ALL-IN", cls: "bg-destructive/15 text-destructive border-destructive/40", Icon: Flame },
  raise: { text: "TỐ", cls: "bg-warning/15 text-warning border-warning/40", Icon: TrendingUp },
  bet: { text: "CƯỢC", cls: "bg-warning/15 text-warning border-warning/40", Icon: Coins },
  call: { text: "THEO", cls: "bg-success/15 text-success border-success/40", Icon: ArrowRightLeft },
  check: { text: "CHECK", cls: "bg-secondary text-muted-foreground border-border/60", Icon: Minus },
  fold: { text: "BỎ", cls: "bg-secondary text-muted-foreground border-border/60", Icon: X },
  post: { text: "BLIND", cls: "bg-secondary text-muted-foreground border-border/60", Icon: Coins },
  action: { text: "•", cls: "bg-secondary text-muted-foreground border-border/60", Icon: Circle },
};

function safePlayerName(name: string, fallback: string): string {
  const trimmed = name.trim();
  return !trimmed || /^[a-f0-9]{6}$/i.test(trimmed) ? fallback : trimmed;
}

export function LiveUpdatesFeed({ feed, rpt = false }: LiveUpdatesFeedProps) {
  const { t } = useTranslation();

  if (rpt) {
    return (
      <section className="space-y-2" aria-labelledby="viewer-current-hand-title">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h2 id="viewer-current-hand-title" className="tracker-display flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-success motion-safe:animate-pulse" />
            {t("liveHub.feed.currentHand", "Ván đang diễn ra")}
          </h2>
          {feed.length > 0 && <span className="tracker-num text-[10px] text-muted-foreground">{t("liveHub.feed.latest", "Mới nhất trước")}</span>}
        </div>

        {feed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/55 bg-card/35 px-4 py-5 text-center text-xs text-muted-foreground">
            {t("liveHub.feed.empty", "Chưa có hành động nào trong ván hiện tại")}
          </div>
        ) : (
          <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {feed.map((item, index) => {
              const meta = KIND_META[item.kind] || KIND_META.action;
              const Icon = meta.Icon;
              const label = t(`liveHub.feed.verb.${item.actionType}`, item.label, { amount: fmtCompact(item.amount ?? 0) });
              const player = safePlayerName(item.playerName, t("liveHub.handFeed.unknownPlayer", "Người chơi"));
              return (
                <article
                  key={item.id}
                  className={`min-w-[190px] snap-start rounded-xl border bg-card/70 p-3 shadow-[0_12px_32px_hsl(var(--background)_/_0.28)] sm:min-w-[220px] ${
                    index === 0 ? "border-[hsl(var(--viewer-neon)_/_0.45)]" : "border-border/55"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${meta.cls}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        {item.seatNumber > 0 && <span>{t("liveHub.seat", "Ghế {{n}}", { n: item.seatNumber })}</span>}
                        <span className="truncate font-semibold text-foreground">{player}</span>
                      </div>
                      <p className="tracker-num mt-0.5 truncate text-xs font-bold text-[hsl(var(--viewer-neon))]">{label}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="tracker-display flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {t("liveHub.feed.title", "Cập nhật • Trực tiếp")}
      </div>
      <div className="rounded-xl border border-border/50 bg-card/50 divide-y divide-border/30 overflow-hidden shadow-[0_0_18px_rgba(0,0,0,0.25)]">
        {feed.length === 0 ? (
          <div className="px-3 py-5 text-xs text-muted-foreground text-center italic">
            {t("liveHub.feed.empty", "Chưa có hành động nào trong ván hiện tại")}
          </div>
        ) : (
          feed.map((item) => {
            const meta = KIND_META[item.kind] || KIND_META.action;
            const Icon = meta.Icon;
            // Localized verb label (falls back to the pre-built vi label); badge text.
            const label = t(`liveHub.feed.verb.${item.actionType}`, item.label, {
              amount: fmtCompact(item.amount ?? 0),
            });
            const badge = t(`liveHub.feed.badge.${item.kind}`, meta.text);
            return (
              <div
                key={item.id}
                className="grid grid-cols-[34px_1fr_auto] items-center gap-2.5 px-3 py-2.5"
              >
                <span className={`grid h-[34px] w-[34px] place-items-center rounded-lg border ${meta.cls}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="shrink-0 text-[10px] text-muted-foreground">{t("liveHub.seat", "Ghế {{n}}", { n: item.seatNumber })}</span>
                    <span className="truncate font-semibold text-foreground">{item.playerName}</span>
                  </div>
                  <div className="tracker-num truncate text-[11px] text-warning">{label}</div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${meta.cls}`}>
                  {badge}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
