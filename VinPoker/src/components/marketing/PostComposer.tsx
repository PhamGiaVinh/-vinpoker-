import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/compressImage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, Image as ImageIcon, X, Send, Save } from "lucide-react";

const sb = supabase as any;

const ALL_CHANNELS: { key: "telegram" | "facebook" | "zalo"; label: string }[] = [
  { key: "telegram", label: "Telegram" },
  { key: "facebook", label: "Facebook" },
  { key: "zalo", label: "Zalo OA" },
];

interface Props {
  clubId: string;
  enabledChannels: string[];
  onPosted: () => void;
}

export const PostComposer = ({ clubId, enabledChannels, onPosted }: Props) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [channels, setChannels] = useState<Record<string, boolean>>({ telegram: true });
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [utmSource, setUtmSource] = useState("");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [busy, setBusy] = useState(false);

  // Default-select Telegram when it's enabled; clear selections that are no longer available.
  useEffect(() => {
    setChannels((prev) => {
      const next: Record<string, boolean> = {};
      for (const c of ALL_CHANNELS) next[c.key] = !!prev[c.key] && enabledChannels.includes(c.key);
      if (enabledChannels.includes("telegram") && prev.telegram === undefined) next.telegram = true;
      return next;
    });
  }, [enabledChannels, clubId]);

  const selectedChannels = useMemo(
    () => ALL_CHANNELS.filter((c) => channels[c.key]).map((c) => c.key),
    [channels],
  );

  const parsedHashtags = useMemo(
    () => hashtags.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)),
    [hashtags],
  );

  const reset = () => {
    setTitle(""); setBody(""); setMediaUrls([]); setHashtags("");
    setUtmSource(""); setUtmCampaign(""); setScheduleMode("now"); setScheduledAt("");
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!["image/jpeg", "image/png"].includes(f.type)) { toast.error(t("marketing.composer.onlyJpgPng")); return; }
    if (f.size > 5 * 1024 * 1024) { toast.error(t("marketing.composer.max5mb")); return; }
    setUploading(true);
    try {
      const file = await compressImage(f, { maxEdge: 1920, quality: 0.85 });
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `marketing/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { error } = await supabase.storage.from("app-assets").upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type,
      });
      if (error) { toast.error(error.message); return; }
      const url = supabase.storage.from("app-assets").getPublicUrl(path).data.publicUrl;
      setMediaUrls((u) => [...u, url]);
    } finally {
      setUploading(false);
    }
  };

  const friendlyError = (err: any): string => {
    const code = err?.error ?? err?.message ?? "";
    if (code === "COMPLIANCE_BLOCKED") {
      const flags = Array.isArray(err?.flags) ? err.flags.join(", ") : "";
      return t("marketing.composer.errCompliance", { terms: flags });
    }
    if (code === "CHANNEL_NOT_CONFIGURED") return t("marketing.composer.errChannel", { channel: err?.channel ?? "" });
    if (code === "NO_CHANNELS") return t("marketing.composer.errNoChannels");
    if (code === "Forbidden") return t("marketing.composer.errForbidden");
    return code || t("marketing.composer.errGeneric");
  };

  const createDraft = async (): Promise<string | null> => {
    const utm: Record<string, string> = {};
    if (utmSource.trim()) utm.source = utmSource.trim();
    if (utmCampaign.trim()) utm.campaign = utmCampaign.trim();
    const { data, error } = await sb.rpc("marketing_create_post", {
      p_club_id: clubId,
      p_title: title.trim() || null,
      p_body: body.trim(),
      p_channels: selectedChannels,
      p_media_urls: mediaUrls,
      p_hashtags: parsedHashtags,
      p_utm: utm,
      p_client_request_id: (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`),
    });
    if (error) { toast.error(error.message); return null; }
    if (data?.error) { toast.error(friendlyError(data)); return null; }
    return data?.post_id ?? null;
  };

  const onSaveDraft = async () => {
    if (!body.trim()) { toast.error(t("marketing.composer.errBody")); return; }
    setBusy(true);
    try {
      const id = await createDraft();
      if (id) { toast.success(t("marketing.composer.savedDraft")); reset(); onPosted(); }
    } finally { setBusy(false); }
  };

  const onSchedule = async () => {
    if (!body.trim()) { toast.error(t("marketing.composer.errBody")); return; }
    if (selectedChannels.length === 0) { toast.error(t("marketing.composer.errNoChannels")); return; }
    if (scheduleMode === "later" && !scheduledAt) { toast.error(t("marketing.composer.errPickTime")); return; }
    setBusy(true);
    try {
      const id = await createDraft();
      if (!id) return;
      const whenIso = scheduleMode === "later" ? new Date(scheduledAt).toISOString() : null;
      const { data, error } = await sb.rpc("marketing_schedule_post", { p_post_id: id, p_scheduled_at: whenIso });
      if (error) { toast.error(error.message); return; }
      if (data?.error) { toast.error(friendlyError(data)); return; }
      toast.success(scheduleMode === "later" ? t("marketing.composer.scheduled") : t("marketing.composer.publishing"));
      reset(); onPosted();
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t("marketing.composer.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">{t("marketing.composer.postTitle")}</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("marketing.composer.postTitlePh")} maxLength={200} />
        </div>

        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">{t("marketing.composer.body")} *</Label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder={t("marketing.composer.bodyPh")} />
        </div>

        {/* Image */}
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">{t("marketing.composer.image")}</Label>
          <div className="flex flex-wrap items-center gap-2">
            {mediaUrls.map((u) => (
              <div key={u} className="relative">
                <img src={u} alt="" className="h-16 w-16 rounded object-cover" />
                <button
                  type="button"
                  onClick={() => setMediaUrls((arr) => arr.filter((x) => x !== u))}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                  aria-label={t("marketing.composer.removeImage")}
                ><X className="h-3 w-3" /></button>
              </div>
            ))}
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              {t("marketing.composer.addImage")}
              <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
          </div>
        </div>

        {/* Channels */}
        <div>
          <Label className="mb-1.5 block text-xs text-muted-foreground">{t("marketing.composer.channels")}</Label>
          <div className="flex flex-wrap gap-4">
            {ALL_CHANNELS.map((c) => {
              const available = enabledChannels.includes(c.key);
              return (
                <label key={c.key} className={`flex items-center gap-2 text-sm ${available ? "" : "opacity-50"}`}>
                  <Checkbox
                    checked={!!channels[c.key]}
                    disabled={!available}
                    onCheckedChange={(v) => setChannels((prev) => ({ ...prev, [c.key]: !!v }))}
                  />
                  {c.label}
                  {!available && <span className="text-[11px] text-muted-foreground">({t("marketing.composer.comingSoon")})</span>}
                </label>
              );
            })}
          </div>
        </div>

        {/* Schedule */}
        <div>
          <Label className="mb-1.5 block text-xs text-muted-foreground">{t("marketing.composer.schedule")}</Label>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="mkt-sched" checked={scheduleMode === "now"} onChange={() => setScheduleMode("now")} />
              {t("marketing.composer.publishNow")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="mkt-sched" checked={scheduleMode === "later"} onChange={() => setScheduleMode("later")} />
              {t("marketing.composer.scheduleLater")}
            </label>
            {scheduleMode === "later" && (
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-auto" />
            )}
          </div>
        </div>

        {/* UTM + hashtags */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("marketing.composer.hashtags")}</Label>
            <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#vinpoker #giải" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">UTM source</Label>
              <Input value={utmSource} onChange={(e) => setUtmSource(e.target.value)} placeholder="telegram" />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">UTM campaign</Label>
              <Input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} placeholder="khaimac" />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" onClick={onSaveDraft} disabled={busy || uploading}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            {t("marketing.composer.saveDraft")}
          </Button>
          <Button onClick={onSchedule} disabled={busy || uploading}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {scheduleMode === "later" ? t("marketing.composer.scheduleBtn") : t("marketing.composer.publishBtn")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
