import { useTranslation } from "react-i18next";
import type { TvData } from "@/types/tv";
import { TvHeader } from "./TvHeader";
import { TvStatsBar } from "./TvStatsBar";
import { formatClock, formatVndCompact } from "@/lib/tv/format";

/**
 * Full-screen payout structure (tv_displays.layout = 'payouts').
 * Shows the prize ladder large enough to read across the room, with a small
 * level/clock line so the floor never loses the time.
 */
export function TvPayoutsScreen({ data }: { data: TvData }) {
  const { t } = useTranslation();
  const prizes = data.prizes.slice(0, 12);

  return (
    <div className="flex h-full min-h-screen w-full flex-col bg-background text-foreground">
      <TvHeader data={data} />
      <main className="flex flex-col items-center justify-center gap-[2.6vmin] px-[4vmin] py-[2vmin] lg:min-h-0 lg:flex-1">
        <div className="text-[3.2vmin] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
          {t("tv.payoutsTitle")}
        </div>
        {data.currentLevel ? (
          <div className="text-[2.2vmin] tabular-nums text-muted-foreground">
            {t("tv.level")} {data.currentLevel.levelNumber} · {formatClock(data.remainingSeconds)}
          </div>
        ) : null}
        {prizes.length > 0 ? (
          <div className="grid w-full max-w-[150vmin] grid-cols-1 gap-x-[6vmin] gap-y-[1.6vmin] sm:grid-cols-2 lg:grid-cols-3">
            {prizes.map((prize) => (
              <div
                key={prize.position}
                className="flex items-baseline justify-between gap-[2vmin] border-b border-border/40 pb-[0.8vmin]"
              >
                <span className="text-[3.4vmin] font-bold tabular-nums text-primary">
                  {prize.position}.
                </span>
                <span className="text-[4vmin] font-bold tabular-nums">
                  {formatVndCompact(prize.amount)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[2.6vmin] text-muted-foreground">{t("tv.noPayouts")}</div>
        )}
        {data.prizePool != null ? (
          <div className="text-[2.8vmin] tabular-nums text-muted-foreground">
            {t("tv.prizePool")}:{" "}
            <span className="font-bold text-foreground">{formatVndCompact(data.prizePool)}</span>
            {data.guarantee != null ? ` · GTD ${formatVndCompact(data.guarantee)}` : ""}
          </div>
        ) : null}
      </main>
      <TvStatsBar data={data} />
    </div>
  );
}
