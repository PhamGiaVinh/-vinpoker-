import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Captions, CaptionsOff, Loader2, AlertTriangle, MessageCircle, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import YouTubeLiveChat from "@/components/YouTubeLiveChat";
import { parseSrt, findActiveCue, type SrtCue } from "@/lib/parseSrt";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytReadyPromise: Promise<any> | null = null;
const loadYouTubeAPI = (): Promise<any> => {
  if (ytReadyPromise) return ytReadyPromise;
  ytReadyPromise = new Promise((resolve) => {
    if (typeof window === "undefined") return;
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return ytReadyPromise;
};

const DEFAULT_VIDEO_ID = "aqz-KE-bpBo";

const safeDecodeUrl = (raw: string): string => {
  let url = raw;
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(url);
      if (decoded === url) break;
      url = decoded;
    } catch {
      break;
    }
  }
  return url;
};

type SrtState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; cues: SrtCue[] }
  | { status: "error"; message: string };

export default function Video() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const videoId = params.get("videoId") || DEFAULT_VIDEO_ID;
  const subtitleUrlParam = params.get("subtitleUrl") || "";
  const subtitleUrl = subtitleUrlParam ? safeDecodeUrl(subtitleUrlParam) : "";
  const title = params.get("title") || t("videoPage.defaultTitle");

  // Persistent host node — created once, reparented across portrait/landscape
  // wrappers so the YouTube iframe is never destroyed (which would cause the
  // black-screen on rotate).
  const hostNodeRef = useRef<HTMLDivElement | null>(null);
  if (typeof document !== "undefined" && !hostNodeRef.current) {
    const el = document.createElement("div");
    el.style.width = "100%";
    el.style.height = "100%";
    hostNodeRef.current = el;
  }
  const portraitSlotRef = useRef<HTMLDivElement | null>(null);
  const landscapeSlotRef = useRef<HTMLDivElement | null>(null);

  const playerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const [showSubs, setShowSubs] = useState(true);
  const [activeCue, setActiveCue] = useState<SrtCue | null>(null);
  const [srt, setSrt] = useState<SrtState>({ status: "idle" });
  const [isLandscape, setIsLandscape] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);

  // Detect mobile landscape
  useEffect(() => {
    const mql = window.matchMedia("(orientation: landscape) and (max-height: 500px)");
    const onChange = () => setIsLandscape(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  // Reparent the persistent host into the active slot whenever orientation flips.
  useEffect(() => {
    const node = hostNodeRef.current;
    if (!node) return;
    const target = isLandscape ? landscapeSlotRef.current : portraitSlotRef.current;
    if (target && node.parentNode !== target) {
      target.appendChild(node);
    }
  }, [isLandscape]);

  // Lock body scroll in landscape
  useEffect(() => {
    if (!isLandscape) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isLandscape]);

  // Auto-hide floating controls in landscape
  useEffect(() => {
    if (!isLandscape) {
      setControlsVisible(true);
      return;
    }
    const bump = () => {
      setControlsVisible(true);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2500);
    };
    bump();
    window.addEventListener("pointerdown", bump);
    window.addEventListener("pointermove", bump);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("pointermove", bump);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [isLandscape]);

  // Fetch SRT
  useEffect(() => {
    if (!subtitleUrl) {
      setSrt({ status: "idle" });
      return;
    }
    let cancelled = false;
    setSrt({ status: "loading" });
    fetch(subtitleUrl, { credentials: "omit", cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        const cues = parseSrt(text);
        if (cues.length === 0) {
          setSrt({ status: "error", message: t("videoPage.subtitleInvalidOrEmpty") });
        } else {
          setSrt({ status: "ready", cues });
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setSrt({ status: "error", message: t("videoPage.subtitleLoadFailed", { reason: e?.message || t("videoPage.networkError") }) });
      });
    return () => { cancelled = true; };
  }, [subtitleUrl, t]);

  // Slot ref callbacks: when a slot mounts, attach the persistent host into it.
  const attachPortraitSlot = useCallback((el: HTMLDivElement | null) => {
    portraitSlotRef.current = el;
    const node = hostNodeRef.current;
    if (el && node && !isLandscape && node.parentNode !== el) {
      el.appendChild(node);
    }
  }, [isLandscape]);

  const attachLandscapeSlot = useCallback((el: HTMLDivElement | null) => {
    landscapeSlotRef.current = el;
    const node = hostNodeRef.current;
    if (el && node && isLandscape && node.parentNode !== el) {
      el.appendChild(node);
    }
  }, [isLandscape]);

  // Init YT player on the persistent host node ONCE per videoId.
  useEffect(() => {
    let destroyed = false;
    const node = hostNodeRef.current;
    if (!node) return;
    loadYouTubeAPI().then((YT) => {
      if (destroyed) return;
      if (playerRef.current) return;
      playerRef.current = new YT.Player(node, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
      });
    });
    return () => {
      destroyed = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { playerRef.current?.destroy?.(); } catch {}
      playerRef.current = null;
    };
  }, [videoId]);

  const cues = srt.status === "ready" ? srt.cues : null;
  useEffect(() => {
    if (!cues) {
      setActiveCue(null);
      return;
    }
    let last = -1;
    const tick = () => {
      const p = playerRef.current;
      if (p && typeof p.getCurrentTime === "function") {
        try {
          const t = p.getCurrentTime() as number;
          if (t !== last) {
            last = t;
            const c = findActiveCue(cues, t);
            setActiveCue((prev) => (prev?.id === c?.id ? prev : c));
          }
        } catch {}
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [cues]);

  const subtitleBox = useMemo(() => {
    if (!showSubs) return null;
    if (srt.status === "loading") {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("videoPage.loadingSubtitle")}
        </div>
      );
    }
    if (srt.status === "error") {
      return (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{srt.message}</span>
        </div>
      );
    }
    if (srt.status === "idle") {
      return <div className="text-sm text-muted-foreground">{t("videoPage.noSubtitleHint")}</div>;
    }
    return (
      <div className="text-base leading-relaxed whitespace-pre-line min-h-[2.5rem]">
        {activeCue?.text || <span className="text-muted-foreground italic">…</span>}
      </div>
    );
  }, [showSubs, srt, activeCue, t]);

  return (
    <>
      {/* Portrait/desktop layout — always mounted so the player slot exists. */}
      <div className={isLandscape ? "hidden" : "space-y-4 max-w-7xl mx-auto"}>
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/documents" aria-label={t("videoPage.backAriaLabel")}>
                <ArrowLeft className="w-5 h-5" />
              </Link>
            </Button>
            <h1 className="text-xl md:text-2xl font-display font-black tracking-wider">{title}</h1>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            {showSubs ? <Captions className="w-4 h-4 text-primary" /> : <CaptionsOff className="w-4 h-4 text-muted-foreground" />}
            <span className="text-muted-foreground">{t("videoPage.subtitlesLabel")}</span>
            <Switch checked={showSubs} onCheckedChange={setShowSubs} />
          </label>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
          <div className="space-y-4 min-w-0">
            <Card className="overflow-hidden border-border/60 bg-black">
              <AspectRatio ratio={16 / 9}>
                <div ref={attachPortraitSlot} className="w-full h-full" />
              </AspectRatio>
            </Card>

            {/* Mobile / tablet collapsible chat */}
            <div className="lg:hidden">
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <span className="inline-flex items-center gap-2">
                      <MessageCircle className="w-4 h-4" />
                      {t("videoPage.chat")}
                    </span>
                    <ChevronDown className="w-4 h-4 transition-transform data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <Card className="overflow-hidden border-border/60 h-[60vh]">
                    <YouTubeLiveChat videoId={videoId} />
                  </Card>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>

          {/* Desktop side panel chat */}
          <Card className="hidden lg:block overflow-hidden border-border/60 min-h-[480px]">
            <YouTubeLiveChat videoId={videoId} />
          </Card>
        </div>

        {showSubs && (
          <Card className="bg-background/80 backdrop-blur border-border/60 p-4">
            <ScrollArea className="max-h-48">
              {subtitleBox}
            </ScrollArea>
          </Card>
        )}
      </div>


      {/* Landscape immersive overlay */}
      {isLandscape && (
        <div className="fixed inset-0 z-50 bg-black">
          <div ref={attachLandscapeSlot} className="absolute inset-0" />

          {/* Subtitle overlay */}
          {showSubs && activeCue && (
            <div className="pointer-events-none absolute bottom-[8%] left-1/2 -translate-x-1/2 max-w-[90%] px-3 py-1.5 rounded-md bg-black/40">
              <div className="text-white font-medium text-base sm:text-lg leading-snug text-center whitespace-pre-line [text-shadow:_0_1px_3px_rgb(0_0_0_/_90%),_0_0_8px_rgb(0_0_0_/_60%)]">
                {activeCue.text}
              </div>
            </div>
          )}

          {/* Floating controls */}
          <div
            className={`absolute top-2 left-2 right-2 flex items-center justify-between transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          >
            <Button asChild variant="secondary" size="icon" className="h-9 w-9 bg-black/50 hover:bg-black/70 border-0 text-white pointer-events-auto">
              <Link to="/documents" aria-label={t("videoPage.backAriaLabel")}>
                <ArrowLeft className="w-5 h-5" />
              </Link>
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setShowSubs((v) => !v)}
              aria-label={t("videoPage.toggleSubtitlesAriaLabel")}
              className="h-9 w-9 bg-black/50 hover:bg-black/70 border-0 text-white pointer-events-auto"
            >
              {showSubs ? <Captions className="w-5 h-5" /> : <CaptionsOff className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
