import { useEffect, useRef, useState } from "react";
import { Music2, Volume2, VolumeX, ExternalLink, Play, Pause } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface StickerMusic {
  source: "library" | "soundcloud";
  name: string;
  artist?: string | null;
  thumbnail_url?: string | null;
  // library
  file_url?: string | null;
  // soundcloud
  iframe_src?: string | null;
  soundcloud_url?: string | null;
}

interface Props {
  music: StickerMusic;
}

const MUTED_KEY = "story-music-muted";

/**
 * Instagram-style music sticker overlay.
 * - Library: uses <audio> element directly.
 * - SoundCloud: uses hidden iframe + SoundCloud Widget API for play/pause/mute.
 */
export function StoryMusicSticker({ music }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [muted, setMuted] = useState<boolean>(() => {
    try { return localStorage.getItem(MUTED_KEY) === "1"; } catch { return false; }
  });
  const [playing, setPlaying] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const widgetRef = useRef<any>(null);

  // Persist mute across stories (IG behaviour)
  useEffect(() => {
    try { localStorage.setItem(MUTED_KEY, muted ? "1" : "0"); } catch {}
    if (music.source === "library" && audioRef.current) {
      audioRef.current.volume = muted ? 0 : 0.7;
    }
    if (music.source === "soundcloud" && widgetRef.current) {
      try { widgetRef.current.setVolume(muted ? 0 : 70); } catch {}
    }
  }, [muted, music.source]);

  // Library audio
  useEffect(() => {
    if (music.source !== "library" || !music.file_url) return;
    const a = new Audio(music.file_url);
    a.loop = true;
    a.volume = muted ? 0 : 0.7;
    a.play().then(() => { setPlaying(true); setNeedsTap(false); })
      .catch(() => { setNeedsTap(true); setPlaying(false); });
    audioRef.current = a;
    return () => { a.pause(); audioRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [music.file_url, music.source]);

  // SoundCloud iframe + widget
  useEffect(() => {
    if (music.source !== "soundcloud" || !music.iframe_src) return;
    let cancelled = false;

    const loadApi = () =>
      new Promise<any>((resolve, reject) => {
        if ((window as any).SC?.Widget) return resolve((window as any).SC);
        const existing = document.querySelector<HTMLScriptElement>('script[data-sc-api]');
        if (existing) {
          existing.addEventListener("load", () => resolve((window as any).SC));
          existing.addEventListener("error", reject);
          return;
        }
        const s = document.createElement("script");
        s.src = "https://w.soundcloud.com/player/api.js";
        s.async = true;
        s.dataset.scApi = "1";
        s.onload = () => resolve((window as any).SC);
        s.onerror = reject;
        document.head.appendChild(s);
      });

    loadApi().then((SC: any) => {
      if (cancelled || !iframeRef.current || !SC?.Widget) return;
      const w = SC.Widget(iframeRef.current);
      widgetRef.current = w;
      w.bind(SC.Widget.Events.READY, () => {
        try {
          w.setVolume(muted ? 0 : 70);
          w.play();
        } catch {}
      });
      w.bind(SC.Widget.Events.PLAY, () => { setPlaying(true); setNeedsTap(false); });
      w.bind(SC.Widget.Events.PAUSE, () => setPlaying(false));
      w.bind(SC.Widget.Events.FINISH, () => { try { w.seekTo(0); w.play(); } catch {} });
      w.bind(SC.Widget.Events.ERROR, () => setNeedsTap(true));
    }).catch(() => setNeedsTap(true));

    return () => {
      cancelled = true;
      try { widgetRef.current?.pause(); } catch {}
      widgetRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [music.iframe_src, music.source]);

  const togglePlay = () => {
    if (music.source === "library") {
      const a = audioRef.current;
      if (!a) return;
      if (a.paused) a.play().then(() => { setPlaying(true); setNeedsTap(false); }).catch(() => setNeedsTap(true));
      else { a.pause(); setPlaying(false); }
    } else {
      const w = widgetRef.current;
      if (!w) return;
      if (playing) w.pause(); else w.play();
    }
  };

  // Build SC src with autoplay
  const scSrc = music.source === "soundcloud" && music.iframe_src
    ? music.iframe_src + (music.iframe_src.includes("auto_play=") ? "" : "&auto_play=true") + "&buying=false&sharing=false&download=false&show_artwork=false&show_playcount=false&show_user=false&hide_related=true"
    : null;

  return (
    <>
      {/* Hidden SoundCloud iframe */}
      {scSrc && (
        <iframe
          ref={iframeRef}
          src={scSrc}
          allow="autoplay"
          title="SoundCloud player"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", border: 0 }}
        />
      )}

      {/* Sticker */}
      <div
        className={cn(
          "absolute bottom-14 left-3 z-20 flex items-center gap-2 rounded-full bg-black/50 backdrop-blur-md border border-white/15 text-white shadow-lg transition-all duration-300",
          expanded ? "right-3 px-3 py-2" : "pr-3 pl-1.5 py-1.5 max-w-[200px]"
        )}
        onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
        role="button"
      >
        <div className={cn(
          "shrink-0 rounded-full overflow-hidden bg-primary/30 flex items-center justify-center",
          expanded ? "w-9 h-9" : "w-7 h-7",
          playing && "animate-spin-slow"
        )}>
          {music.thumbnail_url ? (
            <img src={music.thumbnail_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <Music2 className="w-3.5 h-3.5" />
          )}
        </div>

        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="text-[11px] font-semibold truncate">{music.name}</div>
          {music.artist && <div className="text-[10px] opacity-75 truncate">{music.artist}</div>}
        </div>

        {expanded && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); togglePlay(); }}
              className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center shrink-0"
              aria-label={playing ? t("storyMusicSticker.pause") : t("storyMusicSticker.play")}
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setMuted(m => !m); }}
              className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center shrink-0"
              aria-label={muted ? t("storyMusicSticker.unmute") : t("storyMusicSticker.mute")}
            >
              {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            {music.source === "soundcloud" && music.soundcloud_url && (
              <a
                href={music.soundcloud_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center shrink-0"
                aria-label={t("storyMusicSticker.openSoundcloud")}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </>
        )}

        {!expanded && (
          <button
            onClick={(e) => { e.stopPropagation(); setMuted(m => !m); }}
            className="w-6 h-6 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center shrink-0"
            aria-label={muted ? t("storyMusicSticker.unmute") : t("storyMusicSticker.mute")}
          >
            {muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
          </button>
        )}
      </div>

      {needsTap && (
        <button
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 px-4 py-2 rounded-full bg-black/70 backdrop-blur-md text-white text-sm font-semibold border border-white/20"
        >
          <Play className="w-4 h-4 inline mr-1.5" /> {t("storyMusicSticker.tapToPlay")}
        </button>
      )}
    </>
  );
}
