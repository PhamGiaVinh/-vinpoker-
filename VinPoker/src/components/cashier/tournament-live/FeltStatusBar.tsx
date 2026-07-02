// PR-A1 (liveFeltCompact) — persistent one-row status bar docked directly under the
// viewer felt (RPT pattern: blinds/ante · to-act · pot, always visible while the felt
// itself stays compact). PURE presentational; rendered ONLY by LiveFelt when its
// compact viewer mode is active, so operator/TV/replay-without-flag never mount it.
// Every segment hides when its data is missing (bb<=0, no to-act, pot 0) — the bar
// never fabricates a value.

import { useTranslation } from "react-i18next";
import { formatStack } from "./LiveFelt";

interface FeltStatusBarProps {
  blinds: { sb: number; bb: number; ante: number } | null;
  /** Display name of the player to act (live only; null → segment hidden). */
  toActName: string | null;
  potSize: number;
  formatBB: (n: number) => string | null;
}

export function FeltStatusBar({ blinds, toActName, potSize, formatBB }: FeltStatusBarProps) {
  const { t } = useTranslation();
  const hasBlinds = !!blinds && blinds.bb > 0;
  if (!hasBlinds && !toActName && potSize <= 0) return null;
  return (
    <div
      data-testid="felt-status-bar"
      className="tracker-display mt-1.5 flex w-full items-center gap-2 overflow-hidden rounded-lg border border-border/40 bg-card/60 px-2.5 py-1 text-[10px] leading-none"
    >
      {hasBlinds && (
        <span className="flex shrink-0 items-center gap-1">
          <span
            className="rounded-sm px-1 py-px text-[8px] font-bold uppercase tracking-wide text-black"
            style={{ background: "hsl(var(--primary))" }}
          >
            {t("liveHub.felt.blinds", "Blind")}
          </span>
          <span className="tracker-num font-bold text-white">
            {formatStack(blinds!.sb)}/{formatStack(blinds!.bb)}
          </span>
          {blinds!.ante > 0 && (
            <span className="tracker-num text-white/60">
              · A {formatStack(blinds!.ante)}
            </span>
          )}
        </span>
      )}
      {toActName && (
        <span className="min-w-0 flex-1 truncate text-amber-300/90">
          {t("liveHub.felt.toAct", "chờ")}: <span className="font-semibold text-amber-200">{toActName}</span>
        </span>
      )}
      {!toActName && <span className="min-w-0 flex-1" />}
      {potSize > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          <span
            className="rounded-sm px-1 py-px text-[8px] font-bold uppercase tracking-wide text-black"
            style={{ background: "hsl(var(--poker-gold))" }}
          >
            {t("liveHub.felt.pot", "Pot")}
          </span>
          <span className="tracker-num font-bold" style={{ color: "hsl(var(--poker-gold))" }}>
            {formatStack(potSize)}
          </span>
          {formatBB(potSize) && <span className="tracker-num text-white/50">({formatBB(potSize)})</span>}
        </span>
      )}
    </div>
  );
}
