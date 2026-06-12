import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TvClockScreen } from "@/components/tv/TvClockScreen";
import { useMockTvData } from "@/lib/tv/mockTvData";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useFullscreen } from "@/hooks/useFullscreen";

const CURSOR_IDLE_MS = 3000;

/**
 * TV projection route — renders outside Layout (no app chrome).
 * PR A serves mock data only; PR B swaps in useTournamentTvData(tournamentId)
 * and keeps ?mock=1 as the demo switch. No operator controls live here.
 */
const TournamentTv = () => {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { t } = useTranslation();

  const data = useMockTvData();
  const isMock = true; // PR A: always mock; PR B keys this off ?mock=1

  useWakeLock();
  const { isFullscreen, isSupported, enter } = useFullscreen();
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [cursorIdle, setCursorIdle] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${data.tournamentName} — TV`;
    return () => {
      document.title = previousTitle;
    };
  }, [data.tournamentName]);

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

  return (
    <div
      data-tournament-id={tournamentId}
      className={`relative h-screen w-screen overflow-y-auto bg-background lg:overflow-hidden ${cursorIdle ? "cursor-none" : ""}`}
    >
      <TvClockScreen data={data} />

      {isMock ? (
        <span className="absolute right-[1.5vmin] top-[11vh] rounded border border-amber-500/50 bg-amber-500/15 px-[1.2vmin] py-[0.4vmin] text-[1.6vmin] font-bold uppercase tracking-widest text-amber-400">
          {t("tv.demo")}
        </span>
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
