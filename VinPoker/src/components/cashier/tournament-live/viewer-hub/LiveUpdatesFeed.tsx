// "Cập nhật • Trực tiếp" live updates feed (Viewer Event Hub). Presentational
// only — rows derived from already-loaded hand actions (newest first). Each row =
// kind icon + player line + action label + kind tag. Theme-aware via semantic
// tokens (works in dark + claude-warm). No invented data (no fake timestamps).

import { useTranslation } from "react-i18next";
import { Flame, TrendingUp, Coins, ArrowRightLeft, Minus, X, Circle, type LucideIcon } from "lucide-react";
import { fmtCompact, type HubFeedItem, type HubFeedKind } from "./hubDerive";

export interface LiveUpdatesFeedProps {
  feed: HubFeedItem[];
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

export function LiveUpdatesFeed({ feed }: LiveUpdatesFeedProps) {
  const { t } = useTranslation();
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
