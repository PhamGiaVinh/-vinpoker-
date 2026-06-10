import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Music2, Upload, Trash2, Loader2, Play, Pause } from "lucide-react";

interface Track {
  id: string;
  name: string;
  artist: string | null;
  file_url: string;
  duration: number | null;
  genre: string | null;
  source: string;
  created_at: string;
}

export function StoryMusicManager() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [artist, setArtist] = useState("");
  const [genre, setGenre] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("feed_story_music").select("*").order("created_at", { ascending: false });
    setTracks((data ?? []) as Track[]);
    setLoading(false);
  };

  useEffect(() => { load(); return () => { audioRef.current?.pause(); }; }, []);

  const readDuration = (f: File): Promise<number | null> => new Promise(res => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.onloadedmetadata = () => res(Math.round(a.duration) || null);
    a.onerror = () => res(null);
    a.src = URL.createObjectURL(f);
  });

  const upload = async () => {
    if (!file) { toast.error("Chọn file mp3"); return; }
    if (!name.trim()) { toast.error("Nhập tên bài"); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error("File quá 20MB"); return; }
    setUploading(true);
    try {
      const duration = await readDuration(file);
      const ext = file.name.split(".").pop() ?? "mp3";
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("feed-story-music").upload(path, file);
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("feed-story-music").getPublicUrl(path);
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("feed_story_music").insert({
        name: name.trim(),
        artist: artist.trim() || null,
        genre: genre.trim() || null,
        file_url: data.publicUrl,
        duration,
        source: "admin_upload",
        created_by: user?.id,
      });
      if (error) throw error;
      toast.success("Đã thêm nhạc");
      setName(""); setArtist(""); setGenre(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (e: any) {
      toast.error(e.message ?? "Upload thất bại");
    } finally { setUploading(false); }
  };

  const remove = async (t: Track) => {
    if (!confirm(`Xoá "${t.name}"?`)) return;
    const { error } = await supabase.from("feed_story_music").delete().eq("id", t.id);
    if (error) { toast.error(error.message); return; }
    // best-effort: remove storage file when it lives in feed-story-music bucket
    try {
      const marker = "/feed-story-music/";
      const idx = t.file_url.indexOf(marker);
      if (idx >= 0) {
        const path = t.file_url.slice(idx + marker.length);
        await supabase.storage.from("feed-story-music").remove([path]);
      }
    } catch { /* ignore */ }
    toast.success("Đã xoá");
    load();
  };

  const togglePlay = (t: Track) => {
    if (playing === t.id) { audioRef.current?.pause(); setPlaying(null); return; }
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = t.file_url;
    audioRef.current.play().catch(() => toast.error("Không phát được"));
    audioRef.current.onended = () => setPlaying(null);
    setPlaying(t.id);
  };

  const fmt = (s: number | null) => s ? `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}` : "—";

  return (
    <div className="space-y-4">
      <Card className="p-3 space-y-2">
        <div className="text-sm font-semibold flex items-center gap-2"><Upload className="w-4 h-4" /> Upload nhạc mới</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input placeholder="Tên bài *" value={name} onChange={e => setName(e.target.value)} />
          <Input placeholder="Nghệ sĩ" value={artist} onChange={e => setArtist(e.target.value)} />
          <Input placeholder="Thể loại (chill, energetic…)" value={genre} onChange={e => setGenre(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="audio/mpeg,audio/mp3,audio/wav" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-sm flex-1" />
          <Button onClick={upload} disabled={uploading || !file}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Thêm"}
          </Button>
        </div>
      </Card>

      <div className="text-sm font-semibold">Thư viện ({tracks.length})</div>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : tracks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có nhạc.</p>
      ) : tracks.map(t => (
        <Card key={t.id} className="p-3 flex items-center gap-3">
          <button onClick={() => togglePlay(t)} className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
            {playing === t.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Music2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <div className="font-semibold truncate">{t.name}</div>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground shrink-0">{t.source === "seed" ? "seed" : "upload"}</span>
            </div>
            <div className="text-xs text-muted-foreground truncate">{t.artist ?? "—"} · {t.genre ?? "—"} · {fmt(t.duration)}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => remove(t)}>
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </Card>
      ))}
    </div>
  );
}
