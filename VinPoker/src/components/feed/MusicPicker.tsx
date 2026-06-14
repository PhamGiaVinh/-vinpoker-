import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { Music2, Play, Pause, Check, Search, X, Loader2, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export type StoryMusic =
  | {
      source: "library";
      id: string;
      name: string;
      artist: string | null;
      file_url: string;
      duration: number | null;
      genre: string | null;
      thumbnail_url?: string | null;
    }
  | {
      source: "soundcloud";
      name: string;
      artist: string | null;
      soundcloud_url: string;
      iframe_src: string;
      thumbnail_url: string | null;
    };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (music: StoryMusic | null) => void;
  selected?: StoryMusic | null;
}

const SC_URL_RE = /^(?:https?:\/\/)?(?:www\.|m\.|on\.)?soundcloud\.com\//i;

export function MusicPicker({ open, onOpenChange, onSelect, selected }: Props) {
  const { t } = useTranslation();
  const [tracks, setTracks] = useState<Extract<StoryMusic, { source: "library" }>[]>([]);
  const [search, setSearch] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // SoundCloud tab state
  const [scUrl, setScUrl] = useState("");
  const [scLoading, setScLoading] = useState(false);
  const [scPreview, setScPreview] = useState<Extract<StoryMusic, { source: "soundcloud" }> | null>(null);

  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
      setPlaying(null);
      setScPreview(null);
      setScUrl("");
      return;
    }
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("feed_story_music")
        .select("id,name,artist,file_url,duration,genre,thumbnail_url")
        .order("created_at", { ascending: false });
      if (mounted) {
        setTracks(((data ?? []) as any[]).map(t => ({ source: "library" as const, ...t })));
        setLoading(false);
      }
    })();
    return () => { mounted = false; audioRef.current?.pause(); };
  }, [open]);

  const togglePlay = (track: Extract<StoryMusic, { source: "library" }>) => {
    if (playing === track.id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = track.file_url;
    audioRef.current.volume = 0.7;
    audioRef.current.play().catch(() => {});
    audioRef.current.onended = () => setPlaying(null);
    setPlaying(track.id);
  };

  const filtered = tracks.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.artist ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const fmtDur = (s: number | null) => {
    if (!s) return null;
    const m = Math.floor(s / 60); const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  const fetchSoundCloud = async () => {
    const url = scUrl.trim();
    if (!SC_URL_RE.test(url)) {
      toast.error(t("musicPicker.invalidScLink"));
      return;
    }
    setScLoading(true);
    setScPreview(null);
    try {
      const { data, error } = await supabase.functions.invoke("soundcloud-oembed", { body: { url } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const d = data as { title: string; author_name: string | null; thumbnail_url: string | null; iframe_src: string };
      setScPreview({
        source: "soundcloud",
        name: d.title,
        artist: d.author_name,
        thumbnail_url: d.thumbnail_url,
        iframe_src: d.iframe_src,
        soundcloud_url: url,
      });
    } catch (e: any) {
      toast.error(e?.message ?? t("musicPicker.scFetchFailed"));
    } finally {
      setScLoading(false);
    }
  };

  const selectedId = selected?.source === "library" ? selected.id : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Music2 className="w-5 h-5 text-primary" /> {t("musicPicker.dialogTitle")}</DialogTitle>
        </DialogHeader>

        {selected && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/10 border border-primary/30">
            {selected.thumbnail_url ? (
              <img src={selected.thumbnail_url} className="w-8 h-8 rounded object-cover shrink-0" alt="" />
            ) : (
              <Music2 className="w-4 h-4 text-primary shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{selected.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {selected.source === "soundcloud" ? "SoundCloud" : t("musicPicker.sourceLibrary")}
                {selected.artist ? ` · ${selected.artist}` : ""}
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onSelect(null)}><X className="w-3 h-3" /></Button>
          </div>
        )}

        <Tabs defaultValue="library">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="library"><Music2 className="w-3.5 h-3.5 mr-1" /> {t("musicPicker.tabLibrary")}</TabsTrigger>
            <TabsTrigger value="soundcloud"><Cloud className="w-3.5 h-3.5 mr-1" /> SoundCloud</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="mt-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("musicPicker.searchPlaceholder")} className="pl-8" />
            </div>
            <div className="max-h-[45vh] overflow-y-auto -mx-2 px-2 space-y-1">
              {loading ? (
                <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
              ) : filtered.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">{t("musicPicker.emptyTracks")}</div>
              ) : filtered.map(track => (
                <button
                  key={track.id}
                  onClick={() => { audioRef.current?.pause(); onSelect(track); onOpenChange(false); }}
                  className={cn(
                    "w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted text-left transition",
                    selectedId === track.id && "bg-primary/10"
                  )}
                >
                  <div
                    role="button"
                    onClick={e => { e.stopPropagation(); togglePlay(track); }}
                    className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:opacity-90"
                  >
                    {playing === track.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{track.name}</div>
                    {track.artist && <div className="text-[11px] text-muted-foreground truncate">{track.artist}</div>}
                  </div>
                  {track.duration && <div className="text-[11px] text-muted-foreground">{fmtDur(track.duration)}</div>}
                  {selectedId === track.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="soundcloud" className="mt-3 space-y-3">
            <div className="text-xs text-muted-foreground">{t("musicPicker.scHelper")}</div>
            <div className="flex gap-2">
              <Input
                value={scUrl}
                onChange={e => setScUrl(e.target.value)}
                placeholder="https://soundcloud.com/..."
                onKeyDown={e => { if (e.key === "Enter") fetchSoundCloud(); }}
              />
              <Button onClick={fetchSoundCloud} disabled={scLoading || !scUrl.trim()}>
                {scLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("musicPicker.fetchButton")}
              </Button>
            </div>

            {scPreview && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                  {scPreview.thumbnail_url && (
                    <img src={scPreview.thumbnail_url} className="w-14 h-14 rounded object-cover shrink-0" alt="" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{scPreview.name}</div>
                    {scPreview.artist && <div className="text-xs text-muted-foreground truncate">{scPreview.artist}</div>}
                  </div>
                </div>
                <iframe
                  src={scPreview.iframe_src}
                  width="100%"
                  height="120"
                  allow="autoplay"
                  title={t("musicPicker.scIframeTitle")}
                  className="rounded-lg"
                  style={{ border: 0 }}
                />
                <Button
                  className="w-full"
                  onClick={() => { onSelect(scPreview); onOpenChange(false); }}
                >
                  <Check className="w-4 h-4 mr-1" /> {t("musicPicker.useThisTrack")}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
