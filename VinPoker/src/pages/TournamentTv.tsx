import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TvClockScreen } from "@/components/tv/TvClockScreen";
import { useMockTvData } from "@/lib/tv/mockTvData";
import { useTournamentTvData } from "@/hooks/useTournamentTvData";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useFullscreen } from "@/hooks/useFullscreen";

const CURSOR_IDLE_MS = 3000;

function TvStatusScreen({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-screen w-full flex-col items-center justify-center gap-[2vmin] px-[6vmin] text-center">
      <div className="text-[5vmin] font-bold text-foreground">{title}</div>
      {hint ? <div className="text-[2.4vmin] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/**
 * TV projection route — renders outside Layout (no app chrome).
 * PR B: real read-only data via useTournamentTvData; ?mock=1 keeps the
 * self-ticking demo (never shown for real tournament IDs without the flag).
 * No operator controls live here.
 */
const TournamentTv = () => {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();

  const isMock = searchParams.get("mock") === "1";
  const mockData = useMockTvData(isMock);
  const live = useTournamentTvData(tournamentId, { enabled: !isMock });
  const data = isMock ? mockData : live.data;

  useWakeLock();
  const { isFullscreen, isSupported, enter } = useFullscreen();
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [cursorIdle, setCursorIdle] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = data ? `${data.tournamentName} — TV` : "VinPoker TV";
    return () => {
      document.title = previousTitle;
    };
  }, [data?.tournamentName]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const reset = () => {
      setCursorIdle(false);
      clearTimeout(timeout);
      timeout = setTimeout(() => setCursorIdle(true), CURSOR_IDLE_MS);
    };
    reset();
    window.addEventListener("mousemove", reset);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousemove", reset);
    };
  }, []);

  const showFullscreenPrompt = isSupported && !isFullscreen && !promptDismissed;
  const showScreen = isMock || (live.state === "ready" && data);

  return (
    <div
      data-tournament-id={tournamentId}
      className={`relative h-screen w-screen overflow-y-auto bg-background lg:overflow-hidden ${cursorIdle ? "cursor-none" : ""}`}
    >
      {showScreen && data ? (
        <TvClockScreen data={data} />
      ) : live.state === "loading" ? (
        <TvStatusScreen title={t("tv.loading")} />
      ) : live.state === "auth_required" ? (
        <TvStatusScreen title={t("tv.authRequired")} hint={t("tv.authRequiredHint")} />
      ) : live.state === "not_found" ? (
        <TvStatusScreen title={t("tv.notFound")} hint={t("tv.notFoundHint")} />
      ) : (
        <TvStatusScreen title={t("tv.loadError")} hint={t("tv.loadErrorHint")} />
      )}

      {isMock ? (
        <span className="absolute right-[1.5vmin] top-[11vh] rounded border border-amber-500/50 bg-amber-500/15 px-[1.2vmin] py-[0.4vmin] text-[1.6vmin] font-bold uppercase tracking-widest text-amber-400">
          {t("tv.demo")}
        </span>
      ) : null}

      {!isMock && live.state === "ready" && live.realtimeStatus === "offline" ? (
        <span
          title={t("tv.offline")}
          className="absolute bottom-[1.5vmin] left-[1.5vmin] h-[1.2vmin] w-[1.2vmin] animate-pulse rounded-full bg-amber-500/80"
        />
      ) : null}

      {showFullscreenPrompt ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-[2.5vmin] bg-background/80 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => {
              enter();
              setPromptDismissed(true);
            }}
            className="rounded-full border border-primary/60 bg-primary/10 px-[3vmin] py-[1.4vmin] text-[2.6vmin] font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            {t("tv.fullscreenPrompt")}
          </button>
          <button
            type="button"
            onClick={() => setPromptDismissed(true)}
            className="text-[1.8vmin] text-muted-foreground underline underline-offset-4"
          >
            {t("tv.fullscreenSkip")}
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default TournamentTv;
