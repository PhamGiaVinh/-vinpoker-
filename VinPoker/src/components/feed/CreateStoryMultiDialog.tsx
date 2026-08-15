import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, Loader2, X, ChevronLeft, ChevronRight, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEED_MEDIA_ACCEPT, getFeedMediaKind, validateFeedMediaFile } from "@/lib/feedMedia";

interface StoryFile {
  file: File;
  preview: string;
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
  userId: string;
}

const MAX_FILES = 10;

export function CreateStoryMultiDialog({ onClose, onCreated, userId }: Props) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<StoryFile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cur = files[currentIndex];

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming);
    const next: StoryFile[] = [...files];
    for (const f of arr) {
      if (next.length >= MAX_FILES) { toast.error(t("createStory.maxFilesReached", { max: MAX_FILES })); break; }
      const kind = getFeedMediaKind(f);
      const validationError = validateFeedMediaFile(f);
      if (validationError === "unsupported_type" || !kind) { toast.error(t("createStory.fileInvalid", { name: f.name })); continue; }
      if (validationError === "too_large") { toast.error(t("createStory.fileTooLarge", { name: f.name, limit: kind === "video" ? "50MB" : "10MB" })); continue; }
      next.push({ file: f, preview: URL.createObjectURL(f) });
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
          const mediaKind = getFeedMediaKind(sf.file);
          if (!mediaKind) throw new Error("Unsupported feed media type");
          const { error: insErr } = await supabase.from("feed_stories").insert({
            author_id: userId,
            media_url: data.publicUrl,
            media_type: mediaKind,
          });
          if (insErr) { console.error(insErr); continue; }
          ok++;
        } catch (e) { console.error(e); }
      }
      if (ok > 0) {
        toast.success(t("createStory.postedCount", { ok, total: files.length }));
        cleanup();
        onCreated();
      } else {
        toast.error(t("createStory.postFailed"));
      }
    } finally { setUploading(false); }
  };

  return (
    <>
      <Dialog open onOpenChange={v => { if (!v) { cleanup(); onClose(); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-primary" /> {t("createStory.title")}
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
                <div className="text-sm font-semibold">{t("createStory.choosePhotoOrVideo")}</div>
                <div className="text-xs text-muted-foreground">{t("createStory.multiFileHint", { max: MAX_FILES })}</div>
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
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button onClick={() => fileRef.current?.click()} variant="outline" size="sm" className="flex-1" disabled={files.length >= MAX_FILES}>
                    {t("createStory.addFile")}
                  </Button>
                  <Button onClick={uploadAll} disabled={uploading} className="flex-1">
                    {uploading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> {t("createStory.posting")}</> : t("createStory.postCount", { count: files.length })}
                  </Button>
                </div>
              </>
            )}

            <input
              ref={fileRef}
              type="file"
              accept={FEED_MEDIA_ACCEPT}
              multiple
              hidden
              onChange={e => addFiles(e.target.files)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
