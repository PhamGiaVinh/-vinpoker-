import { useTranslation } from "react-i18next";
import type { TvData, TvLevel } from "@/types/tv";
import { formatBlinds, formatChips, formatClock } from "@/lib/tv/format";

function levelSummary(level: TvLevel, breakLabel: string): string {
  if (level.isBreak) return breakLabel;
  const blinds = formatBlinds(level.smallBlind, level.bigBlind);
  return level.ante > 0 ? `${blinds} (${formatChips(level.ante)})` : blinds;
}

export function TvBlindsPanel({ data, side }: { data: TvData; side: "current" | "next" }) {
  const { t } = useTranslation();

  if (side === "current") {
    const level = data.currentLevel;
    return (
      <div className="flex min-w-0 flex-col items-center justify-center gap-[3vmin]">
        <div className="flex flex-col items-center gap-[0.8vmin]">
          <div className="text-[2.2vmin] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("tv.blinds")}
          </div>
          <div className="text-[7vmin] font-bold leading-none tabular-nums text-foreground">
            {level && !level.isBreak ? formatBlinds(level.smallBlind, level.bigBlind) : "—"}
          </div>
        </div>
        {level && !level.isBreak && level.ante > 0 ? (
          <div className="flex flex-col items-center gap-[0.8vmin]">
            <div className="text-[2.2vmin] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("tv.ante")}
            </div>
            <div className="text-[5vmin] font-bold leading-none tabular-nums text-foreground/90">
              {formatChips(level.ante)}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-[3vmin]">
      <div className="flex flex-col items-center gap-[0.8vmin]">
        <div className="text-[2.2vmin] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("tv.nextLevel")}
        </div>
        <div className="text-[4.5vmin] font-bold leading-none tabular-nums text-foreground/90">
          {data.nextLevel ? levelSummary(data.nextLevel, t("tv.breakTitle")) : "—"}
        </div>
      </div>
      {data.nextBreakSeconds != null ? (
        <div className="flex flex-col items-center gap-[0.8vmin]">
          <div className="text-[2.2vmin] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("tv.nextBreak")}
          </div>
          <div className="font-mono text-[4.5vmin] font-bold leading-none tabular-nums text-foreground/90">
            {formatClock(data.nextBreakSeconds)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
