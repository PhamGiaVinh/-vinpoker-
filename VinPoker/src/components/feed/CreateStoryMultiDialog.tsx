import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, Music2, Loader2, X, ChevronLeft, ChevronRight, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MusicPicker, type StoryMusic } from "./MusicPicker";

interface StoryFile {
  file: File;
  preview: string;
  music: StoryMusic | null;
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
  userId: string;
}

const MAX_FILES = 10;
const IMAGE_MAX = 10 * 1024 * 1024;
const VIDEO_MAX = 50 * 1024 * 1024;

export function CreateStoryMultiDialog({ onClose, onCreated, userId }: Props) {
  const [files, setFiles] = useState<StoryFile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [musicPickerOpen, setMusicPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cur = files[currentIndex];

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming);
    const next: StoryFile[] = [...files];
    for (const f of arr) {
      if (next.length >= MAX_FILES) { toast.error(`Tối đa ${MAX_FILES} file`); break; }
      const isVideo = f.type.startsWith("video/");
      const isImage = f.type.startsWith("image/");
      if (!isVideo && !isImage) { toast.error(`${f.name} không hợp lệ`); continue; }
      const max = isVideo ? VIDEO_MAX : IMAGE_MAX;
      if (f.size > max) { toast.error(`${f.name} quá ${isVideo ? "50MB" : "10MB"}`); continue; }
      next.push({ file: f, preview: URL.createObjectURL(f), music: null });
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeAt = (i: number) => {
    setFiles(prev => {
      URL.revokeObjectURL(prev[i].preview);
      const next = prev.filter((_, idx) => idx !== i);
      if (currentIndex >= next.length && next.length > 0) setCurrentIndex(next.length - 1);
      else if (next.length === 0) setCurrentIndex(0);
      return next;
    });
  };

  const setMusic = (m: StoryMusic | null) => {
    setFiles(prev => prev.map((f, i) => i === currentIndex ? { ...f, music: m } : f));
  };

  const applyMusicToAll = () => {
    if (!cur?.music) { toast.error("Chưa chọn nhạc"); return; }
    setFiles(prev => prev.map(f => ({ ...f, music: cur.music })));
    toast.success("Đã áp dụng cho tất cả");
  };

  const cleanup = () => files.forEach(f => URL.revokeObjectURL(f.preview));

  const uploadAll = async () => {
    if (files.length === 0) return;
    setUploading(true);
    let ok = 0;
    try {
      for (const sf of files) {
        try {
          const ext = sf.file.name.split(".").pop() ?? "bin";
          const path = `${userId}/stories/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: upErr } = await supabase.storage.from("feed-media").upload(path, sf.file);
          if (upErr) { console.error(upErr); continue; }
          const { data } = supabase.storage.from("feed-media").getPublicUrl(path);
          const m = sf.music;
          const musicFields = m
            ? m.source === "library"
              ? {
                  music_source: "library",
                  music_url: m.file_url,
                  music_name: m.name,
                  music_artist: m.artist,
                  music_thumbnail_url: m.thumbnail_url ?? null,
                  music_soundcloud_url: null,
                  music_html: null,
                }
              : {
                  music_source: "soundcloud",
                  music_url: null,
                  music_name: m.name,
                  music_artist: m.artist,
                  music_thumbnail_url: m.thumbnail_url ?? null,
                  music_soundcloud_url: m.soundcloud_url,
                  music_html: m.iframe_src,
                }
            : {};
          const { error: insErr } = await supabase.from("feed_stories").insert({
            author_id: userId,
            media_url: data.publicUrl,
            media_type: sf.file.type.startsWith("video") ? "video" : "image",
            ...musicFields,
          });
          if (insErr) { console.error(insErr); continue; }
          ok++;
        } catch (e) { console.error(e); }
      }
      if (ok > 0) {
        toast.success(`Đã đăng ${ok}/${files.length} story`);
        cleanup();
        onCreated();
      } else {
        toast.error("Đăng story thất bại");
      }
    } finally { setUploading(false); }
  };

  return (
    <>
      <Dialog open onOpenChange={v => { if (!v) { cleanup(); onClose(); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-primary" /> Tạo Story
              {files.length > 0 && <span className="text-xs font-normal text-muted-foreground ml-1">{currentIndex + 1}/{files.length}</span>}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {files.length === 0 ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full h-80 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-2 hover:border-primary hover:bg-muted/30 transition"
              >
                <ImageIcon className="w-12 h-12 text-muted-foreground" />
                <div className="text-sm font-semibold">Chọn ảnh hoặc video</div>
                <div className="text-xs text-muted-foreground">Có thể chọn nhiều file (tối đa {MAX_FILES})</div>
              </button>
            ) : (
              <>
                <div className="relative aspect-[9/16] w-full bg-black rounded-lg overflow-hidden">
                  {cur.file.type.startsWith("image") ? (
                    <img src={cur.preview} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <video src={cur.preview} className="w-full h-full object-contain" controls playsInline />
                  )}

                  {files.length > 1 && currentIndex > 0 && (
                    <button onClick={() => setCurrentIndex(i => i - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center">
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                  )}
                  {files.length > 1 && currentIndex < files.length - 1 && (
                    <button onClick={() => setCurrentIndex(i => i + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  )}

                  <button onClick={() => removeAt(currentIndex)} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </button>

                  {cur.music && (
                    <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-white">
                      {cur.music.thumbnail_url ? (
                        <img src={cur.music.thumbnail_url} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
                      ) : (
                        <Music2 className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{cur.music.name}</div>
                        {cur.music.artist && <div className="text-[10px] opacity-75 truncate">{cur.music.artist}</div>}
                      </div>
                      <button onClick={() => setMusic(null)} className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {files.length > 1 && (
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {files.map((f, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrentIndex(i)}
                        className={cn(
                          "relative shrink-0 w-14 h-14 rounded overflow-hidden border-2 transition",
                          i === currentIndex ? "border-primary" : "border-border"
                        )}
                      >
                        {f.file.type.startsWith("image") ? (
                          <img src={f.preview} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <video src={f.preview} className="w-full h-full object-cover" />
                        )}
                        {f.music && (
                          <div className="absolute bottom-0 right-0 w-4 h-4 rounded-tl bg-primary text-primary-foreground flex items-center justify-center">
                            <Music2 className="w-2.5 h-2.5" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={() => setMusicPickerOpen(true)} variant="outline" size="sm" className="flex-1">
                    <Music2 className="w-4 h-4 mr-1" /> {cur?.music ? "Đổi nhạc" : "Thêm nhạc"}
                  </Button>
                  {cur?.music && files.length > 1 && (
                    <Button onClick={applyMusicToAll} variant="outline" size="sm">Áp dụng cho tất cả</Button>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button onClick={() => fileRef.current?.click()} variant="outline" size="sm" className="flex-1" disabled={files.length >= MAX_FILES}>
                    + Thêm file
                  </Button>
                  <Button onClick={uploadAll} disabled={uploading} className="flex-1">
                    {uploading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Đang đăng…</> : `Đăng ${files.length} story`}
                  </Button>
                </div>
              </>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/mp4,video/webm,video/quicktime"
              multiple
              hidden
              onChange={e => addFiles(e.target.files)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <MusicPicker
        open={musicPickerOpen}
        onOpenChange={setMusicPickerOpen}
        onSelect={setMusic}
        selected={cur?.music}
      />
    </>
  );
}
