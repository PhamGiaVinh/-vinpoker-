import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { SyncingBadge } from "@/components/SyncingBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Newspaper, Plus, Pencil, Trash2, Loader2, EyeOff, CalendarClock, Link2, Send, CalendarIcon, Upload, ImagePlus, X } from "lucide-react";
import { formatShortDate } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { compressImage } from "@/lib/compressImage";
import { useRef } from "react";

interface NewsItem {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body: string | null;
  cover_url: string | null;
  status: string;
  is_featured: boolean;
  published_at: string | null;
  view_count: number;
}

type Mode = "draft" | "publish_now" | "scheduled";

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `tin-${Date.now()}`;

const empty = { title: "", summary: "", body: "", cover_url: "", is_featured: false };

const PUBLIC_ORIGIN = "https://vinpoker.live";

const News = () => {
  const { t } = useTranslation();
  const { isMediaOrAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NewsItem | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);
  const [mode, setMode] = useState<Mode>("publish_now");
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [scheduleTime, setScheduleTime] = useState<string>("09:00");
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingInline, setUploadingInline] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const uploadImage = async (raw: File): Promise<string | null> => {
    if (!["image/jpeg", "image/png"].includes(raw.type)) {
      toast.error(t("newsPage.form.onlyJpgPng"));
      return null;
    }
    if (raw.size > 5 * 1024 * 1024) {
      toast.error(t("newsPage.form.max5mb"));
      return null;
    }
    const file = await compressImage(raw, { maxEdge: 1920, quality: 0.85 });
    const ext = file.type === "image/png" ? "png" : "jpg";
    const path = `news/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await supabase.storage.from("app-assets").upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type,
    });
    if (error) { toast.error(error.message); return null; }
    return supabase.storage.from("app-assets").getPublicUrl(path).data.publicUrl;
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setUploadingCover(true);
    const url = await uploadImage(f);
    setUploadingCover(false);
    if (url) setForm((p) => ({ ...p, cover_url: url }));
  };

  const handleInlineUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setUploadingInline(true);
    const url = await uploadImage(f);
    setUploadingInline(false);
    if (!url) return;
    const ta = bodyRef.current;
    const insert = `\n\n![](${url})\n\n`;
    if (ta) {
      const start = ta.selectionStart ?? form.body.length;
      const end = ta.selectionEnd ?? form.body.length;
      const next = form.body.slice(0, start) + insert + form.body.slice(end);
      setForm((p) => ({ ...p, body: next }));
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + insert.length;
        ta.setSelectionRange(pos, pos);
      });
    } else {
      setForm((p) => ({ ...p, body: p.body + insert }));
    }
    toast.success(t("newsPage.form.imageInserted"));
  };


  const {
    data: items = [],
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["news", isMediaOrAdmin],
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const q = supabase.from("news_posts").select("*").order("published_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
      const { data, error } = isMediaOrAdmin ? await q : await q.eq("status", "published");
      if (error) throw error;
      return (data ?? []) as NewsItem[];
    },
  });
  const loading = isLoading && items.length === 0;
  const load = () => { refetch(); };

  const openNew = () => {
    setEditing(null);
    setForm(empty);
    setMode("publish_now");
    setScheduleDate(undefined);
    setScheduleTime("09:00");
    setOpen(true);
  };
  const openEdit = (n: NewsItem) => {
    setEditing(n);
    setForm({ title: n.title, summary: n.summary ?? "", body: n.body ?? "", cover_url: n.cover_url ?? "", is_featured: n.is_featured });
    if (n.status === "draft") setMode("draft");
    else if (n.status === "scheduled") {
      setMode("scheduled");
      if (n.published_at) {
        const d = new Date(n.published_at);
        setScheduleDate(d);
        setScheduleTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
      }
    } else {
      setMode("publish_now");
    }
    setOpen(true);
  };

  const save = async () => {
    if (!form.title.trim()) { toast.error(t("newsPage.form.needTitle")); return; }

    let status = "draft";
    let publishedAt: string | null = null;

    if (mode === "publish_now") {
      status = "published";
      publishedAt = editing?.published_at && editing.status === "published" ? editing.published_at : new Date().toISOString();
    } else if (mode === "scheduled") {
      if (!scheduleDate) { toast.error(t("newsPage.form.needDate")); return; }
      const [hh, mm] = scheduleTime.split(":").map(Number);
      const d = new Date(scheduleDate);
      d.setHours(hh || 0, mm || 0, 0, 0);
      if (d.getTime() <= Date.now()) { toast.error(t("newsPage.form.futureOnly")); return; }
      status = "scheduled";
      publishedAt = d.toISOString();
    }

    setSaving(true);
    const payload: any = {
      title: form.title.trim(),
      summary: form.summary.trim() || null,
      body: form.body.trim() || null,
      cover_url: form.cover_url.trim() || null,
      is_featured: form.is_featured,
      status,
      published_at: publishedAt,
    };
    let res;
    if (editing) {
      res = await supabase.from("news_posts").update(payload).eq("id", editing.id);
    } else {
      payload.slug = `${slugify(form.title)}-${Math.random().toString(36).slice(2, 6)}`;
      res = await supabase.from("news_posts").insert(payload);
    }
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(
      editing
        ? t("newsPage.form.updated")
        : mode === "scheduled"
          ? t("newsPage.form.scheduled")
          : mode === "draft"
            ? t("newsPage.form.draftSaved")
            : t("newsPage.form.published")
    );
    setOpen(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("newsPage.confirmDelete"))) return;
    const { error } = await supabase.from("news_posts").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success(t("newsPage.deleted")); load(); }
  };

  const publishNow = async (n: NewsItem) => {
    const { error } = await supabase.from("news_posts")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", n.id);
    if (error) toast.error(error.message); else { toast.success(t("newsPage.form.published")); load(); }
  };

  const copyLink = async (slug: string) => {
    const url = `${PUBLIC_ORIGIN}/news/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("newsPage.linkCopied"));
    } catch {
      toast.error(t("newsPage.copyFailed") + url);
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display font-black text-4xl md:text-5xl tracking-tight flex items-center gap-3">
            <Newspaper className="w-9 h-9 text-primary" /> {t("newsPage.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 flex items-center gap-2 flex-wrap">
            {t("newsPage.subtitle")}
            <SyncingBadge isFetching={isFetching && !isLoading} isError={isError && items.length > 0} />
          </p>
        </div>
        {isMediaOrAdmin && (
          <Button onClick={openNew} className="gradient-neon text-primary-foreground shadow-neon">
            <Plus className="w-4 h-4 mr-1" /> {t("newsPage.newPost")}
          </Button>
        )}
      </section>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : isError && items.length === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <p className="text-destructive font-semibold">Không tải được tin tức</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Thử lại</Button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">{t("newsPage.empty")}</Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((n) => (
            <Card key={n.id} className="overflow-hidden gradient-card border border-border hover:border-primary/40 transition-colors group">
              <Link to={`/news/${n.slug}`} className="block">
                {n.cover_url ? (
                  <div className="aspect-[16/9] overflow-hidden bg-muted">
                    <img src={n.cover_url} alt={n.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  </div>
                ) : (
                  <div className="aspect-[16/9] bg-gradient-to-br from-primary/20 to-secondary flex items-center justify-center">
                    <Newspaper className="w-10 h-10 text-primary/60" />
                  </div>
                )}
              </Link>
              <div className="p-5">
                <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase mb-2 flex-wrap">
                  <span className="text-primary">{n.published_at ? formatShortDate(n.published_at) : t("newsPage.draft")}</span>
                  {n.is_featured && <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary">{t("newsPage.featured")}</span>}
                  {n.status === "draft" && <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground inline-flex items-center gap-1"><EyeOff className="w-3 h-3" />{t("newsPage.draft")}</span>}
                  {n.status === "scheduled" && n.published_at && (
                    <span className="px-1.5 py-0.5 rounded bg-accent/20 text-accent-foreground inline-flex items-center gap-1 border border-accent/40">
                      <CalendarClock className="w-3 h-3" />{t("newsPage.scheduledLabel")} · {format(new Date(n.published_at), "HH:mm dd/MM")}
                    </span>
                  )}
                </div>
                <Link to={`/news/${n.slug}`}>
                  <h3 className="font-display font-bold text-lg leading-snug hover:text-primary transition-colors">{n.title}</h3>
                </Link>
                {n.summary && <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{n.summary}</p>}
                {isMediaOrAdmin && (
                  <div className="flex gap-2 mt-4 pt-4 border-t border-border/60 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => openEdit(n)}><Pencil className="w-3.5 h-3.5 mr-1" />{t("newsPage.edit")}</Button>
                    <Button size="sm" variant="outline" onClick={() => copyLink(n.slug)}><Link2 className="w-3.5 h-3.5 mr-1" />{t("newsPage.copyLink")}</Button>
                    {n.status === "scheduled" && (
                      <Button size="sm" variant="outline" onClick={() => publishNow(n)}><Send className="w-3.5 h-3.5 mr-1" />{t("newsPage.publishNow")}</Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={() => remove(n.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? t("newsPage.form.editTitle") : t("newsPage.form.newTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>{t("newsPage.form.titleField")}</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>{t("newsPage.form.summary")}</Label><Textarea rows={2} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>{t("newsPage.form.cover")}</Label>
              <input ref={coverInputRef} type="file" accept="image/jpeg,image/png" hidden onChange={handleCoverUpload} />
              {form.cover_url ? (
                <div className="relative inline-block">
                  <img src={form.cover_url} alt="cover" className="h-32 rounded-md border border-border object-cover" />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, cover_url: "" })}
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1"
                    aria-label={t("newsPage.form.removeCover")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : null}
              <div className="flex gap-2 flex-wrap items-center">
                <Button type="button" variant="outline" size="sm" onClick={() => coverInputRef.current?.click()} disabled={uploadingCover}>
                  {uploadingCover ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                  {uploadingCover ? t("newsPage.form.uploading") : t("newsPage.form.uploadCover")}
                </Button>
                <Input
                  value={form.cover_url}
                  onChange={(e) => setForm({ ...form, cover_url: e.target.value })}
                  placeholder="https://..."
                  className="flex-1 min-w-[180px]"
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("newsPage.form.body")}</Label>
                <input ref={inlineInputRef} type="file" accept="image/jpeg,image/png" hidden onChange={handleInlineUpload} />
                <Button type="button" variant="outline" size="sm" onClick={() => inlineInputRef.current?.click()} disabled={uploadingInline}>
                  {uploadingInline ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ImagePlus className="w-4 h-4 mr-1" />}
                  {uploadingInline ? t("newsPage.form.uploading") : t("newsPage.form.insertImage")}
                </Button>
              </div>
              <Textarea ref={bodyRef} rows={10} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={form.is_featured} onCheckedChange={(v) => setForm({ ...form, is_featured: v })} />
              <Label className="cursor-pointer">{t("newsPage.form.isFeatured")}</Label>
            </div>

            <div className="space-y-2">
              <Label>{t("newsPage.form.publishStatus")}</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { v: "draft", label: t("newsPage.form.modeDraft"), icon: EyeOff },
                  { v: "publish_now", label: t("newsPage.form.modePublishNow"), icon: Send },
                  { v: "scheduled", label: t("newsPage.form.modeScheduled"), icon: CalendarClock },
                ] as const).map(({ v, label, icon: Icon }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setMode(v)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-sm font-medium transition-colors",
                      mode === v ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="w-4 h-4" /> {label}
                  </button>
                ))}
              </div>
            </div>

            {mode === "scheduled" && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-md border border-accent/40 bg-accent/5">
                <div className="space-y-1">
                  <Label className="text-xs">{t("newsPage.form.scheduleDate")}</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !scheduleDate && "text-muted-foreground")}>
                        <CalendarIcon className="w-4 h-4 mr-2" />
                        {scheduleDate ? format(scheduleDate, "dd/MM/yyyy") : t("newsPage.form.pickDate")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={scheduleDate}
                        onSelect={setScheduleDate}
                        disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("newsPage.form.scheduleTime")}</Label>
                  <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
                </div>
                {scheduleDate && (
                  <div className="col-span-2 text-xs text-muted-foreground">
                    {t("newsPage.form.scheduleHint", { time: scheduleTime, date: format(scheduleDate, "dd/MM/yyyy") })}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("newsPage.form.cancel")}</Button>
              <Button onClick={save} disabled={saving} className="gradient-neon text-primary-foreground">
                {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} {t("newsPage.form.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default News;
