// One spectator HAND FEED card (RPT-Live-style): tags + pot(+BB) + board + per-player
// rows (avatar, name, 👑 winner, finish badge, revealed/face-down hole cards, chip
// delta abs&BB) + Share / View-hand. Presentational only — props in, no fetching.
// PokerVN / Stitch Dark identity: neon-green `--primary` accents on dark blue-black,
// `--destructive` for losses/eliminations, casino-gold `--warning` for HIGH HAND.

import { useTranslation } from "react-i18next";
import { Crown, Share2, Play } from "lucide-react";
import { PokerCard, CardBack } from "../PokerVisuals";
import { fmtCompact } from "./hubDerive";
import type { HandFeedItem, HandFeedTag } from "./handFeedDerive";

const TAG_META: Record<HandFeedTag, { label: string; cls: string }> = {
  all_in: { label: "ALL-IN", cls: "border-[#991B1B] bg-[#991B1B]/25 text-[#ff9b9b]" },
  big_pot: { label: "BIG POT", cls: "border-success/40 bg-success/15 text-success" },
  high_hand: { label: "HIGH HAND", cls: "border-warning/40 bg-warning/15 text-warning" },
  eliminated: { label: "ELIMINATED", cls: "border-destructive/40 bg-destructive/15 text-destructive" },
};

function pad5(board: string[]): (string | null)[] {
  return [...board, ...Array(Math.max(0, 5 - board.length)).fill(null)].slice(0, 5);
}

function initials(name: string): string {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

export interface HandFeedCardProps {
  item: HandFeedItem;
  /** Open this hand in replay (wired in a later increment). */
  onViewHand?: (handNumber: number) => void;
  onShare?: (handNumber: number) => void;
}

export function HandFeedCard({ item, onViewHand, onShare }: HandFeedCardProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-border/60 bg-card/80 p-3 shadow-[0_0_18px_rgba(0,0,0,0.25)]">
      {/* header: tags + hand # */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {item.tags.map((tag) => {
          const m = TAG_META[tag];
          return (
            <span key={tag} className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${m.cls}`}>
              {t(`liveHub.handFeed.tag.${tag}`, m.label)}
            </span>
          );
        })}
        <span className="tracker-num ml-auto text-[11px] text-muted-foreground">
          {t("liveHub.handFeed.hand", "Hand #{{n}}", { n: item.handNumber })}
        </span>
      </div>

      {/* pot */}
      <div className="mb-2 flex items-baseline gap-2">
        <span className="tracker-num text-lg font-bold text-primary">{fmtCompact(item.potChips)}</span>
        {item.potBB != null && (
          <span className="text-[11px] text-muted-foreground">
            · {item.potBB} {t("liveHub.handFeed.bbPot", "BB pot")}
          </span>
        )}
        {item.sidePotCount > 0 && (
          <span className="tracker-num rounded-full border border-warning/40 px-1.5 text-[9px] font-bold text-warning">
            +{item.sidePotCount} {t("liveHub.handFeed.sidePot", "side")}
          </span>
        )}
      </div>

      {/* board */}
      <div className="mb-2 flex gap-1">
        {pad5(item.board).map((c, i) => (
          <PokerCard key={i} card={c} size="sm" />
        ))}
      </div>

      {/* players */}
      <div className="divide-y divide-border/40">
        {item.players.map((p) => (
          <div key={p.playerId} className="flex items-center gap-2 py-1.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-secondary text-[9px] font-bold text-muted-foreground">
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                initials(p.name)
              )}
            </span>
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate text-xs font-semibold text-foreground">{p.name}</span>
              {p.isWinner && <Crown className="h-3 w-3 shrink-0 text-warning" aria-hidden="true" />}
              {p.isEliminated && p.finishPosition != null && (
                <span className="shrink-0 rounded bg-destructive/15 px-1 text-[9px] font-bold text-destructive">
                  #{p.finishPosition}
                </span>
              )}
            </div>
            <span className="ml-auto flex shrink-0 gap-0.5">
              {p.holeCards ? (
                p.holeCards.map((c, i) => <PokerCard key={i} card={c} size="xs" />)
              ) : (
                <>
                  <CardBack size="xs" />
                  <CardBack size="xs" />
                </>
              )}
            </span>
            <span
              className={`tracker-num w-[88px] shrink-0 text-right text-xs font-bold ${
                p.deltaChips > 0 ? "text-primary" : p.deltaChips < 0 ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {p.deltaChips > 0 ? "+" : p.deltaChips < 0 ? "−" : ""}
              {fmtCompact(Math.abs(p.deltaChips))}
              {p.deltaBB != null && <span className="text-[9px]"> ({p.deltaBB > 0 ? "+" : p.deltaBB < 0 ? "−" : ""}{Math.abs(p.deltaBB)} BB)</span>}
            </span>
          </div>
        ))}
      </div>

      {/* actions */}
      {(onShare || onViewHand) && (
        <div className="mt-2 flex gap-2 border-t border-border/40 pt-2">
          {onShare && (
            <button
              type="button"
              onClick={() => onShare(item.handNumber)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/60 py-1.5 text-[11px] text-muted-foreground transition hover:text-foreground"
            >
              <Share2 className="h-3.5 w-3.5" aria-hidden="true" /> {t("liveHub.handFeed.share", "Chia sẻ")}
            </button>
          )}
          {onViewHand && (
            <button
              type="button"
              onClick={() => onViewHand(item.handNumber)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-[11px] font-semibold text-primary-foreground transition active:scale-[0.99]"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" /> {t("liveHub.handFeed.viewHand", "Xem ván")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
