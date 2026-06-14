import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { parseSrt, type SrtCue } from "@/lib/parseSrt";

const MAX_VIDEO = 500 * 1024 * 1024;
const MAX_FILE = 50 * 1024 * 1024;

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  tags: z.string().trim().max(500).optional().or(z.literal("")),
});

export type DocumentRow = {
  id: string;
  kind: "video" | "file";
  title: string;
  description: string | null;
  tags: string[] | null;
  file_url: string;
  thumbnail_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  is_public: boolean;
  subtitle_url?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: DocumentRow | null;
  onSaved?: () => void;
};

export function DocumentUploadDialog({ open, onOpenChange, editing, onSaved }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"video" | "file">("video");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [thumb, setThumb] = useState<File | null>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [srtPreview, setSrtPreview] = useState<{ count: number; sample: SrtCue[] } | null>(null);
  const [busy, setBusy] = useState(false);

  // Parse SRT locally as soon as user picks a file so they can verify content BEFORE upload
  useEffect(() => {
    if (!srtFile) {
      setSrtPreview(null);
      return;
    }
    let cancelled = false;
    srtFile.text().then((txt) => {
      if (cancelled) return;
      const cues = parseSrt(txt);
      // Show first 2 cues + middle cue so admin can spot wrong/old file immediately
      const sample: SrtCue[] = [];
      if (cues.length > 0) sample.push(cues[0]);
      if (cues.length > 2) sample.push(cues[Math.floor(cues.length / 2)]);
      if (cues.length > 1) sample.push(cues[cues.length - 1]);
      setSrtPreview({ count: cues.length, sample });
    }).catch(() => !cancelled && setSrtPreview({ count: 0, sample: [] }));
    return () => { cancelled = true; };
  }, [srtFile]);

  useEffect(() => {
    if (open) {
      setKind(editing?.kind ?? "video");
      setTitle(editing?.title ?? "");
      setDescription(editing?.description ?? "");
      setTags((editing?.tags ?? []).join(", "));
      setIsPublic(editing?.is_public ?? true);
      setFile(null);
      setThumb(null);
      setSrtFile(null);
      setSrtPreview(null);
      setExternalUrl(editing && editing.kind === "video" && !editing.file_url.includes("/storage/") ? editing.file_url : "");
    }
  }, [open, editing]);

  const upload = async (bucketFile: File, prefix: string) => {
    const ext = bucketFile.name.split(".").pop() ?? "bin";
    const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("documents").upload(path, bucketFile, {
      cacheControl: "3600",
      contentType: bucketFile.type || undefined,
    });
    if (error) throw error;
    return supabase.storage.from("documents").getPublicUrl(path).data.publicUrl;
  };

  const handleSubmit = async () => {
    const parsed = schema.safeParse({ title, description, tags });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      let fileUrl = editing?.file_url ?? "";
      let thumbUrl = editing?.thumbnail_url ?? null;
      let mime = editing?.mime_type ?? null;
      let size = editing?.size_bytes ?? null;

      if (kind === "video" && externalUrl.trim()) {
        fileUrl = externalUrl.trim();
        mime = "video/external";
        size = null;
      } else if (file) {
        const max = kind === "video" ? MAX_VIDEO : MAX_FILE;
        if (file.size > max) {
          toast.error(t("documentsPage.form.tooLarge"));
          setBusy(false);
          return;
        }
        fileUrl = await upload(file, kind);
        mime = file.type;
        size = file.size;
      } else if (!editing) {
        toast.error(t("documentsPage.form.missingFile"));
        setBusy(false);
        return;
      }

      if (thumb) {
        thumbUrl = await upload(thumb, "thumbs");
      }

      let subtitleUrl: string | null = editing?.subtitle_url ?? null;
      if (kind === "video" && srtFile) {
        if (!/\.(srt|txt)$/i.test(srtFile.name)) {
          toast.error(t("documentUpload.subtitleType"));
          setBusy(false);
          return;
        }
        if (srtFile.size > 2 * 1024 * 1024) {
          toast.error(t("documentUpload.subtitleTooLarge"));
          setBusy(false);
          return;
        }
        const path = `${crypto.randomUUID()}-${srtFile.name.replace(/[^\w.-]+/g, "_")}`;
        const { error: subErr } = await supabase.storage
          .from("subtitles")
          .upload(path, srtFile, { contentType: "application/x-subrip", upsert: false });
        if (subErr) throw subErr;
        subtitleUrl = supabase.storage.from("subtitles").getPublicUrl(path).data.publicUrl;
      }

      const tagsArr = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const payload = {
        kind,
        title: title.trim(),
        description: description.trim() || null,
        tags: tagsArr,
        file_url: fileUrl,
        thumbnail_url: thumbUrl,
        mime_type: mime,
        size_bytes: size,
        is_public: isPublic,
        subtitle_url: kind === "video" ? subtitleUrl : null,
      };

      if (editing) {
        const { error } = await supabase.from("documents").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data: u } = await supabase.auth.getUser();
        const { error } = await supabase
          .from("documents")
          .insert({ ...payload, created_by: u.user?.id ?? null });
        if (error) throw error;
      }
      toast.success(t("documentsPage.form.uploaded"));
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 max-h-[90vh] flex flex-col gap-0">
        <DialogHeader className="px-5 pt-4 pb-2 border-b shrink-0">
          <DialogTitle className="text-base">{editing ? t("documentsPage.edit") : t("documentsPage.uploadBtn")}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs text-muted-foreground shrink-0">{t("documentsPage.form.kind")}</Label>
            <RadioGroup
              value={kind}
              onValueChange={(v) => setKind(v as "video" | "file")}
              className="flex gap-4"
            >
              <label className="flex items-center gap-1.5 text-sm">
                <RadioGroupItem value="video" /> {t("documentsPage.form.kindVideo")}
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <RadioGroupItem value="file" /> {t("documentsPage.form.kindFile")}
              </label>
            </RadioGroup>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("documentsPage.form.title")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("documentsPage.form.description")}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} />
          </div>
          {kind === "video" && (
            <div className="space-y-1">
              <Label className="text-xs">{t("documentsPage.form.videoUrl")}</Label>
              <Input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://youtube.com/..." className="h-9" />
            </div>
          )}
          {kind === "video" && (
            <div className="space-y-1">
              <Label className="text-xs">{t("documentUpload.subtitleLabel")}</Label>
              <Input
                type="file"
                accept=".srt,.txt,application/x-subrip,text/plain"
                onChange={(e) => setSrtFile(e.target.files?.[0] ?? null)}
                className="h-9 text-xs"
              />
              {editing?.subtitle_url && !srtFile && (
                <p className="text-[11px] text-muted-foreground truncate">
                  {t("documentUpload.alreadyHas")} <a href={editing.subtitle_url} target="_blank" rel="noreferrer" className="underline">{editing.subtitle_url.split("/").pop()}</a>
                </p>
              )}
              {srtFile && srtPreview && (
                <div className="rounded-md border border-border/60 bg-muted/30 p-2 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold truncate">{srtFile.name}</span>
                    <span className={srtPreview.count > 0 ? "text-primary" : "text-destructive"}>
                      {t("documentUpload.lineCount", { count: srtPreview.count })}
                    </span>
                  </div>
                  {srtPreview.count === 0 ? (
                    <p className="text-destructive">{t("documentUpload.srtReadError")}</p>
                  ) : (
                    <>
                      <p className="text-muted-foreground">{t("documentUpload.previewNote")}</p>
                      <ul className="space-y-1">
                        {srtPreview.sample.map((c) => (
                          <li key={c.id} className="leading-snug">
                            <span className="text-muted-foreground">
                              {new Date(c.startTime * 1000).toISOString().substr(11, 8)}
                            </span>{" "}
                            <span className="whitespace-pre-line">{c.text}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">{t("documentsPage.form.file")}</Label>
            <Input
              type="file"
              accept={kind === "video" ? "video/*" : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("documentsPage.form.thumbnail")}</Label>
            <div className="flex items-center gap-2">
              <Input type="file" accept="image/*" onChange={(e) => setThumb(e.target.files?.[0] ?? null)} className="h-9 text-xs flex-1" />
              {editing?.thumbnail_url && !thumb && (
                <img src={editing.thumbnail_url} alt="" className="h-9 w-14 rounded object-cover shrink-0" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            <Label className="text-xs">{t("documentsPage.form.isPublic")}</Label>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t shrink-0 bg-background">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={busy}>
            {busy ? t("documentsPage.form.uploading") : t("documentsPage.form.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
