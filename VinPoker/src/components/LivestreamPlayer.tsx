import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Radio } from "lucide-react";
import { buildEmbedSrc, type StreamPlatform } from "@/lib/streamUrl";
import { FloatingStreamComments } from "@/components/FloatingStreamComments";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "@/hooks/use-mobile";

interface StreamRow {
  id: string;
  platform: StreamPlatform;
  stream_url: string;
  title: string | null;
  is_live: boolean;
}

export const LivestreamPlayer = ({ tournamentId }: { tournamentId: string }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const userUnmutedRef = useRef(false);

  useEffect(() => {
    const sendCmd = (func: string, args: any[] = []) => {
      Object.values(iframeRefs.current).forEach((f) => {
        if (!f?.contentWindow) return;
        try {
          f.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*");
        } catch {}
      });
    };
    // Resume playback (no force-mute) when app signals it
    const onResume = () => {
      sendCmd("playVideo");
      if (userUnmutedRef.current) sendCmd("unMute");
    };
    // First user gesture → unmute (autoplay starts muted by browser policy)
    const onFirstGesture = () => {
      userUnmutedRef.current = true;
      sendCmd("unMute");
      sendCmd("playVideo");
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
    window.addEventListener("livestream:resume", onResume);
    window.addEventListener("pointerdown", onFirstGesture, { once: false });
    window.addEventListener("keydown", onFirstGesture, { once: false });
    return () => {
      window.removeEventListener("livestream:resume", onResume);
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tournament_streams")
        .select("id,platform,stream_url,title,is_live")
        .eq("tournament_id", tournamentId)
        .order("created_at", { ascending: false });
      if (!cancelled) {
        setStreams((data ?? []) as StreamRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tournamentId]);

  if (loading || streams.length === 0) return null;

  const yt = streams.find((s) => s.platform === "youtube");
  const fb = streams.find((s) => s.platform === "facebook");
  const defaultTab: StreamPlatform = yt ? "youtube" : "facebook";
  const anyLive = streams.some((s) => s.is_live);

  const renderFrame = (s: StreamRow) => {
    const src = buildEmbedSrc(s.platform, s.stream_url, { autoplay: true });
    if (!src) {
      return <div className="grid place-items-center h-full text-sm text-muted-foreground">{t("livestream.invalidLink")}</div>;
    }
    const handleTapUnmute = () => {
      const f = iframeRefs.current[s.id];
      if (!f?.contentWindow) return;
      userUnmutedRef.current = true;
      try {
        f.contentWindow.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [] }), "*");
        f.contentWindow.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "*");
      } catch {}
    };
    return (
      <div className="relative w-full h-full">
        <iframe
          key={s.id}
          ref={(el) => { iframeRefs.current[s.id] = el; }}
          src={src}
          title={s.title || `Stream ${s.platform}`}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
        {/* Block external "Watch on YouTube" / title link (top bar) */}
        <div className="absolute top-0 left-0 right-0 h-12 z-10" aria-hidden onPointerDown={handleTapUnmute} />
        {/* Block YouTube logo link (bottom-right). Wider on mobile. */}
        <div className="absolute bottom-0 right-0 w-32 h-12 z-10" aria-hidden onPointerDown={handleTapUnmute} />
        {/* Block "More videos" / suggestions panel that appears on pause/end (top-right area) */}
        <div className="absolute top-0 right-0 w-24 h-24 z-10" aria-hidden onPointerDown={handleTapUnmute} />
      </div>
    );
  };

  return (
    <Card className="gradient-card border-gold p-4 shadow-gold">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-bold text-base flex items-center gap-2">
          <Radio className="w-4 h-4 text-gold" />
          {t("livestream.title")}
        </h3>
        {anyLive && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-destructive">
            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            {t("livestream.live")}
          </span>
        )}
      </div>

      <div className="sticky top-0 z-30 -mx-4 md:mx-0 md:static md:top-auto md:z-auto bg-background md:bg-transparent">
        {yt && fb ? (
          <Tabs defaultValue={defaultTab}>
            <TabsList className="mb-3 mx-4 md:mx-0">
              <TabsTrigger value="youtube">YouTube</TabsTrigger>
              <TabsTrigger value="facebook">Facebook</TabsTrigger>
            </TabsList>
            <TabsContent value="youtube">
              <div className="relative">
                <AspectRatio ratio={16 / 9} className="md:rounded-lg overflow-hidden bg-black">{renderFrame(yt)}</AspectRatio>
                <FloatingStreamComments tournamentId={tournamentId} overlay />
              </div>
            </TabsContent>
            <TabsContent value="facebook">
              <div className="relative">
                <AspectRatio ratio={16 / 9} className="md:rounded-lg overflow-hidden bg-black">{renderFrame(fb)}</AspectRatio>
                <FloatingStreamComments tournamentId={tournamentId} overlay />
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="relative">
            <AspectRatio ratio={16 / 9} className="md:rounded-lg overflow-hidden bg-black">
              {renderFrame((yt || fb) as StreamRow)}
            </AspectRatio>
            <FloatingStreamComments tournamentId={tournamentId} overlay />
          </div>
        )}
      </div>


      <div className="mt-3 border-t border-border/50 pt-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
          {t("livestream.liveComments")}
        </div>
        <FloatingStreamComments tournamentId={tournamentId} listOnly />
      </div>

      {/* Desktop: composer in card. Mobile: fixed bottom composer above bottom nav */}
      {!isMobile && <FloatingStreamComments tournamentId={tournamentId} inputOnly />}
      {isMobile && (
        <div
          className="fixed inset-x-0 z-40 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] bg-background/95 backdrop-blur-xl border-t border-border/60"
          style={{ bottom: "88px" }}
        >
          <FloatingStreamComments tournamentId={tournamentId} inputOnly />
        </div>
      )}
    </Card>
  );
};
