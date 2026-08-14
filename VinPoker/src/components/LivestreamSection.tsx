import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Loader2, Radio, PlayCircle } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { buildEmbedSrc, type StreamPlatform } from "@/lib/streamUrl";
import { attachLivestreamMetadata, type PublicStreamItem, type PublicStreamRow } from "@/lib/livestreamCatalog";
import { useTranslation } from "react-i18next";

type StreamItem = PublicStreamItem;

type GroupKey = string;

export const LivestreamSection = () => {
  const { t } = useTranslation();
  const [items, setItems] = useState<StreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [playing, setPlaying] = useState<{ title: string; streams: StreamItem[]; activeId: string } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data: streams, error: streamsError } = await supabase
        .from("tournament_streams")
        .select("id,platform,stream_url,title,match_title,scheduled_at,thumbnail_url,custom_tournament_name,is_live,tournament_id")
        .order("is_live", { ascending: false })
        .order("created_at", { ascending: false });

      if (streamsError) {
        setItems([]);
        setLoadError("Không tải được danh sách livestream. Hãy thử lại.");
        setLoading(false);
        return;
      }

      const streamRows = (streams ?? []) as PublicStreamRow[];
      const tournamentIds = [...new Set(streamRows.flatMap((stream) => stream.tournament_id ? [stream.tournament_id] : []))];
      let tournaments: { id: string; name: string; start_time: string; club_id: string }[] = [];
      let clubs: { id: string; name: string }[] = [];

      if (tournamentIds.length > 0) {
        const { data: tournamentRows } = await supabase
          .from("tournaments")
          .select("id,name,start_time,club_id")
          .in("id", tournamentIds);
        tournaments = tournamentRows ?? [];

        const clubIds = [...new Set(tournaments.map((tournament) => tournament.club_id))];
        if (clubIds.length > 0) {
          const { data: clubRows } = await supabase
            .from("clubs")
            .select("id,name")
            .in("id", clubIds);
          clubs = clubRows ?? [];
        }
      }

      setItems(attachLivestreamMetadata(streamRows, tournaments, clubs));
      setLoading(false);
    })();
  }, [reloadKey]);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  if (loadError) {
    return (
      <Card className="p-12 text-center" role="alert">
        <Radio className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button className="mt-4" variant="outline" onClick={() => setReloadKey((value) => value + 1)}>
          Thử lại
        </Button>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="p-12 text-center">
        <Radio className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">Hiện chưa có buổi phát sóng trực tiếp nào.</p>
      </Card>
    );
  }

  // Group by tournament id, or by custom_tournament_name when no tournament
  const groups = new Map<GroupKey, {
    key: GroupKey;
    tourId: string | null;
    name: string;
    clubName: string | null;
    when: string | null;
    streams: StreamItem[];
  }>();
  for (const s of items) {
    let key: GroupKey;
    let name = "";
    let clubName: string | null = null;
    let tourId: string | null = null;
    let when: string | null = null;
    if (s.tournament) {
      key = `t:${s.tournament.id}`;
      tourId = s.tournament.id;
      name = s.tournament.name;
      clubName = s.tournament.club?.name ?? null;
      when = s.tournament.start_time;
    } else {
      const custom = s.custom_tournament_name?.trim() || s.match_title?.trim() || s.title?.trim() || "Stream";
      key = `c:${custom}`;
      name = custom;
      when = s.scheduled_at;
    }
    const cur = groups.get(key);
    if (cur) cur.streams.push(s);
    else groups.set(key, { key, tourId, name, clubName, when, streams: [s] });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from(groups.values()).map((g) => {
        const live = g.streams.some((s) => s.is_live);
        const thumb = g.streams.find((s) => s.thumbnail_url)?.thumbnail_url ?? null;
        const matchTitle = g.streams.find((s) => s.match_title)?.match_title ?? null;
        const cardInner = (
          <Card className="gradient-card border-gold p-4 shadow-gold h-full">
            {thumb && (
              <div className="aspect-video rounded-lg overflow-hidden mb-3 bg-black">
                <img src={thumb} alt={g.name} className="w-full h-full object-cover" loading="lazy" />
              </div>
            )}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                {g.clubName && (
                  <div className="text-[11px] uppercase tracking-wider text-gold/80">{g.clubName}</div>
                )}
                <h3 className="font-display font-bold text-lg truncate">{g.name}</h3>
                {matchTitle && (
                  <div className="text-xs text-foreground/80 mt-0.5 truncate">{matchTitle}</div>
                )}
                {g.when && (
                  <div className="text-xs text-muted-foreground mt-0.5">{formatDateTime(g.when)}</div>
                )}
              </div>
              {live && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-destructive shrink-0">
                  <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" /> LIVE
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
              {g.streams.map((s) => (
                <span key={s.id} className="px-2 py-0.5 rounded-full bg-muted/40 border border-border capitalize">
                  {s.platform}
                </span>
              ))}
            </div>
            {g.tourId ? (
              <Button size="sm" className="w-full gradient-gold text-primary-foreground border-0">
                <PlayCircle className="w-4 h-4 mr-1.5" /> {t("livestream.watchStream")}
              </Button>
            ) : (() => {
              const startedAt = g.when ? new Date(g.when).getTime() : null;
              const started = live || (startedAt !== null && startedAt <= Date.now());
              if (started && g.streams.length > 0) {
                return (
                  <Button
                    size="sm"
                    className="w-full gradient-gold text-primary-foreground border-0"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPlaying({ title: g.name, streams: g.streams, activeId: g.streams[0].id });
                    }}
                  >
                    <PlayCircle className="w-4 h-4 mr-1.5" /> {t("livestream.watchLive")}
                  </Button>
                );
              }
              return (
                <Button size="sm" disabled className="w-full" variant="secondary">
                  <PlayCircle className="w-4 h-4 mr-1.5" /> {t("livestream.comingSoon")}
                </Button>
              );
            })()}
          </Card>
        );
        return g.tourId ? (
          <Link key={g.key} to={`/tournament/${g.tourId}?from=livestream`}>{cardInner}</Link>
        ) : (
          <div key={g.key}>{cardInner}</div>
        );
      })}

      <Dialog open={!!playing} onOpenChange={(o) => !o && setPlaying(null)}>
        <DialogContent className="max-w-4xl p-0 bg-transparent border-0 shadow-none">
          <Card className="gradient-card border-gold p-4 shadow-gold">
            <DialogHeader className="mb-3">
              <DialogTitle className="font-display font-bold text-base flex items-center gap-2 pr-8">
                <Radio className="w-4 h-4 text-gold" />
                {t("livestream.title")}
                {playing?.streams.some((s) => s.is_live) && (
                  <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-destructive">
                    <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                    {t("livestream.live")}
                  </span>
                )}
              </DialogTitle>
              {playing?.title && (
                <div className="text-xs text-muted-foreground text-left">{playing.title}</div>
              )}
            </DialogHeader>
            {playing && (() => {
              const active = playing.streams.find((s) => s.id === playing.activeId) ?? playing.streams[0];
              const src = buildEmbedSrc(active.platform as StreamPlatform, active.stream_url, { autoplay: true });
              return (
                <div className="space-y-3">
                  {playing.streams.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {playing.streams.map((s) => (
                        <Button
                          key={s.id}
                          size="sm"
                          variant={s.id === playing.activeId ? "default" : "outline"}
                          onClick={() => setPlaying({ ...playing, activeId: s.id })}
                          className="capitalize"
                        >
                          {s.platform}
                        </Button>
                      ))}
                    </div>
                  )}
                  <AspectRatio ratio={16 / 9} className="rounded-lg overflow-hidden bg-black">
                    {src ? (
                      <iframe
                        src={src}
                        title={playing.title}
                        className="w-full h-full border-0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                      />
                    ) : (
                      <div className="grid place-items-center h-full text-sm text-muted-foreground">
                        {t("livestream.invalidLink")}
                      </div>
                    )}
                  </AspectRatio>
                </div>
              );
            })()}
          </Card>
        </DialogContent>
      </Dialog>
    </div>
  );
};
