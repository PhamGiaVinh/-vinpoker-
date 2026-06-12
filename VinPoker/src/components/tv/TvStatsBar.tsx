import { useTranslation } from "react-i18next";
import type { TvData } from "@/types/tv";
import { bigBlindsOf, formatChips, formatVndCompact } from "@/lib/tv/format";

interface StatTile {
  label: string;
  value: string;
  sub?: string;
}

export function TvStatsBar({ data }: { data: TvData }) {
  const { t } = useTranslation();

  const bb = bigBlindsOf(data.averageStack, data.currentLevel?.bigBlind);
  const tiles: StatTile[] = [
    {
      label: t("tv.players"),
      value: `${data.playersRemaining}/${data.totalEntries}`,
    },
    {
      label: t("tv.avgStack"),
      value: formatChips(data.averageStack),
      sub: bb != null ? `${bb} BB` : undefined,
    },
  ];
  if (data.totalBuyIns != null) {
    tiles.push({ label: t("tv.totalBuyIns"), value: formatVndCompact(data.totalBuyIns) });
  }
  if (data.reEntries != null) {
    tiles.push({ label: t("tv.reEntries"), value: data.reEntries.toString() });
  }
  if (data.prizePool != null) {
    tiles.push({
      label: t("tv.prizePool"),
      value: formatVndCompact(data.prizePool),
      sub: data.guarantee != null ? `GTD ${formatVndCompact(data.guarantee)}` : undefined,
    });
  }

  return (
    <footer className="flex shrink-0 flex-wrap items-stretch border-t border-border/60 lg:h-[16vh] lg:flex-nowrap lg:divide-x lg:divide-border/60">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex min-w-[33%] flex-1 flex-col items-center justify-center gap-[0.6vmin] px-[1vmin] py-[1.5vmin] lg:min-w-0 lg:py-0"
        >
          <div className="truncate text-[1.9vmin] font-semibold uppercase tracking-widest text-muted-foreground">
            {tile.label}
          </div>
          <div className="truncate text-[4.5vmin] font-bold leading-none tabular-nums text-foreground">
            {tile.value}
          </div>
          {tile.sub ? (
            <div className="truncate text-[2vmin] tabular-nums text-muted-foreground">
              {tile.sub}
            </div>
          ) : null}
        </div>
      ))}
    </footer>
  );
}
