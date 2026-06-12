import { useTranslation } from "react-i18next";
import type { TvData } from "@/types/tv";
import { formatBlinds, formatChips, formatClock } from "@/lib/tv/format";

export function TvBreakOverlay({ data }: { data: TvData }) {
  const { t } = useTranslation();
  const next = data.nextLevel;

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[2.5vmin] bg-sky-500/5">
      <div className="text-[8vmin] font-bold uppercase tracking-[0.2em] text-sky-400">
        {t("tv.breakTitle")}
      </div>
      <div className="font-mono text-[clamp(4rem,22vmin,26rem)] font-bold leading-none tabular-nums text-primary drop-shadow-[0_0_3vmin_hsl(var(--primary)/0.4)]">
        {formatClock(data.remainingSeconds)}
      </div>
      {next && !next.isBreak ? (
        <div className="text-[3vmin] tabular-nums text-muted-foreground">
          {t("tv.nextLevel")}: {t("tv.level")} {next.levelNumber} —{" "}
          {formatBlinds(next.smallBlind, next.bigBlind)}
          {next.ante > 0 ? ` (${formatChips(next.ante)})` : ""}
        </div>
      ) : null}
    </div>
  );
}
