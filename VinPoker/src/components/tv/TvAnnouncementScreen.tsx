import { useTranslation } from "react-i18next";
import type { TvData } from "@/types/tv";
import { TvHeader } from "./TvHeader";
import { formatClock } from "@/lib/tv/format";

/**
 * Full-screen announcement (tv_displays.layout = 'announcement').
 * Renders with or without an assigned tournament: with one, the normal header
 * and a small level/clock footer stay visible; without, a minimal club header.
 */
export function TvAnnouncementScreen({
  announcement,
  clubName,
  data,
}: {
  announcement: string | null;
  clubName: string | null;
  data: TvData | null;
}) {
  const { t } = useTranslation();
  const text = announcement?.trim();

  return (
    <div className="flex h-full min-h-screen w-full flex-col bg-background text-foreground">
      {data ? (
        <TvHeader data={data} />
      ) : (
        <header className="flex h-[10vh] shrink-0 items-center justify-center border-b border-border/60 px-[3vmin]">
          <span className="text-[2.4vmin] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
            {clubName ?? "VinPoker"}
          </span>
        </header>
      )}
      <main className="flex flex-col items-center justify-center px-[8vmin] py-[4vmin] text-center lg:min-h-0 lg:flex-1">
        {text ? (
          <p className="max-w-[160vmin] whitespace-pre-wrap text-[clamp(1.5rem,6vmin,7rem)] font-bold leading-snug text-foreground">
            {text}
          </p>
        ) : (
          <p className="text-[3vmin] text-muted-foreground">{t("tv.noAnnouncement")}</p>
        )}
      </main>
      {data?.currentLevel ? (
        <footer className="flex h-[8vh] shrink-0 items-center justify-center gap-[2vmin] border-t border-border/60 text-[2.2vmin] tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{data.tournamentName}</span>
          <span>
            · {t("tv.level")} {data.currentLevel.levelNumber} · {formatClock(data.remainingSeconds)}
          </span>
        </footer>
      ) : null}
    </div>
  );
}
