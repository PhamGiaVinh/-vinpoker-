import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { SyncingBadge } from "@/components/SyncingBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Globe, Plus, Pencil, Trash2, Loader2, ExternalLink, MapPin, Calendar, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface Evt {
  id: string;
  name: string;
  series: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  venue: string | null;
  start_date: string | null;
  end_date: string | null;
  buy_in_usd: number | null;
  guarantee_usd: number | null;
  poster_url: string | null;
  website_url: string | null;
  description: string | null;
  is_active: boolean;
  display_order: number;
}

const empty = {
  name: "", series: "", country: "", country_code: "", city: "", venue: "",
  start_date: "", end_date: "", buy_in_usd: "", guarantee_usd: "",
  poster_url: "", website_url: "", description: "", is_active: true, display_order: 0,
};

const fmtUSD = (n: number | null) => n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtRange = (a: string | null, b: string | null) => {
  if (!a && !b) return "—";
  const f = (s: string | null) => s ? new Date(s).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "?";
  if (a && b && a !== b) return `${f(a)} → ${f(b)}`;
  return f(a ?? b);
};
const flag = (cc: string | null) => {
  if (!cc || cc.length !== 2) return "🌍";
  return String.fromCodePoint(...cc.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
};

const InternationalEvents = () => {
  const { t } = useTranslation();
  const { isAdmin, isMediaOrAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Evt | null>(null);
  const [form, setForm] = useState<typeof empty>(empty);
  const [saving, setSaving] = useState(false);

  const {
    data: items = [],
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["international-events", isMediaOrAdmin],
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const q = supabase.from("international_events").select("*").order("display_order").order("start_date", { ascending: true, nullsFirst: false });
      const { data, error } = isMediaOrAdmin ? await q : await q.eq("is_active", true);
      if (error) throw error;
      return (data ?? []) as Evt[];
    },
  });
  const loading = isLoading && items.length === 0;
  const load = () => { refetch(); };

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (e: Evt) => {
    setEditing(e);
    setForm({
      name: e.name, series: e.series ?? "", country: e.country ?? "", country_code: e.country_code ?? "",
      city: e.city ?? "", venue: e.venue ?? "",
      start_date: e.start_date ?? "", end_date: e.end_date ?? "",
      buy_in_usd: e.buy_in_usd?.toString() ?? "", guarantee_usd: e.guarantee_usd?.toString() ?? "",
      poster_url: e.poster_url ?? "", website_url: e.website_url ?? "",
      description: e.description ?? "", is_active: e.is_active, display_order: e.display_order,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error(t("internationalPage.toastNameRequired")); return; }
    setSaving(true);
    const payload: any = {
      name: form.name.trim(),
      series: form.series.trim() || null,
      country: form.country.trim() || null,
      country_code: form.country_code.trim().toUpperCase().slice(0, 2) || null,
      city: form.city.trim() || null,
      venue: form.venue.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      buy_in_usd: form.buy_in_usd ? Number(form.buy_in_usd) : null,
      guarantee_usd: form.guarantee_usd ? Number(form.guarantee_usd) : null,
      poster_url: form.poster_url.trim() || null,
      website_url: form.website_url.trim() || null,
      description: form.description.trim() || null,
      is_active: form.is_active,
      display_order: Number(form.display_order) || 0,
    };
    const res = editing
      ? await supabase.from("international_events").update(payload).eq("id", editing.id)
      : await supabase.from("international_events").insert(payload);
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(editing ? t("internationalPage.toastUpdated") : t("internationalPage.toastAdded"));
    setOpen(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("internationalPage.confirmDelete"))) return;
    const { error } = await supabase.from("international_events").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success(t("internationalPage.toastDeleted")); load(); }
  };

  return (
    <div className="space-y-6">
      <section className="relative rounded-2xl bg-gradient-to-br from-card/60 to-card/40 border border-gold/30 p-6 backdrop-blur-sm overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/20 rounded-full blur-3xl opacity-30" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary/10 rounded-full blur-[120px] opacity-20" />
        </div>
        <div className="relative">
          <div className="inline-flex items-center gap-2 mb-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-xs font-semibold text-primary">
              <Globe className="w-3.5 h-3.5" />
              {t("internationalPage.badgeInternational")}
            </span>
          </div>
          <h1 className="font-display text-3xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-2">
            {t("internationalPage.heading")}
          </h1>
          <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap mb-4">
            {t("internationalPage.subtitle")}
            <SyncingBadge isFetching={isFetching && !isLoading} isError={isError && items.length > 0} />
          </p>
          {isMediaOrAdmin && (
            <Button onClick={openNew} className="gradient-gold text-primary-foreground border-0">
              <Plus className="w-4 h-4 mr-1" /> {t("internationalPage.addButton")}
            </Button>
          )}
        </div>
      </section>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : isError && items.length === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <p className="text-destructive font-semibold">{t("internationalPage.loadError")}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>{t("internationalPage.retry")}</Button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">{t("internationalPage.empty")}</Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((e) => (
            <Card key={e.id} className="overflow-hidden gradient-card border border-border hover:border-primary/40 transition-colors group">
              {e.poster_url ? (
                <div className="aspect-[16/9] overflow-hidden bg-muted">
                  <img src={e.poster_url} alt={e.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                </div>
              ) : (
                <div className="aspect-[16/9] bg-gradient-to-br from-primary/20 to-secondary flex items-center justify-center">
                  <Trophy className="w-12 h-12 text-primary/60" />
                </div>
              )}
              <div className="p-5 space-y-3">
                <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase">
                  {e.series && <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary">{e.series}</span>}
                  {!e.is_active && <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t("internationalPage.hiddenBadge")}</span>}
                </div>
                <h3 className="font-display font-bold text-lg leading-snug">{e.name}</h3>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5"><span className="text-base leading-none">{flag(e.country_code)}</span> <MapPin className="w-3.5 h-3.5" /> {[e.city, e.country].filter(Boolean).join(", ") || "—"}{e.venue ? ` · ${e.venue}` : ""}</div>
                  <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {fmtRange(e.start_date, e.end_date)}</div>
                  <div className="flex items-center gap-3">
                    <span><span className="text-muted-foreground/70">{t("internationalPage.buyInLabel")}</span> <span className="font-bold text-foreground">{fmtUSD(e.buy_in_usd)}</span></span>
                    {e.guarantee_usd != null && <span><span className="text-muted-foreground/70">{t("internationalPage.gtdLabel")}</span> <span className="font-bold text-primary">{fmtUSD(e.guarantee_usd)}</span></span>}
                  </div>
                </div>
                {e.description && <p className="text-sm text-muted-foreground line-clamp-3">{e.description}</p>}
                <div className="flex items-center justify-between pt-2 border-t border-border/60">
                  {e.website_url ? (
                    <a href={e.website_url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">
                      {t("internationalPage.websiteLink")} <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : <span />}
                  {isMediaOrAdmin && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(e)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(e.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? t("internationalPage.editTitle") : t("internationalPage.addTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t("internationalPage.fieldName")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("internationalPage.fieldSeries")}</Label><Input placeholder={t("internationalPage.placeholderSeries")} value={form.series} onChange={(e) => setForm({ ...form, series: e.target.value })} /></div>
              <div><Label>{t("internationalPage.fieldCountryCode")}</Label><Input placeholder={t("internationalPage.placeholderCountryCode")} maxLength={2} value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value })} /></div>
              <div><Label>{t("internationalPage.fieldCountry")}</Label><Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
              <div><Label>{t("internationalPage.fieldCity")}</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            </div>
            <div><Label>{t("internationalPage.fieldVenue")}</Label><Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t("internationalPage.fieldStartDate")}</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
              <div><Label>{t("internationalPage.fieldEndDate")}</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
              <div><Label>{t("internationalPage.fieldBuyIn")}</Label><Input type="number" value={form.buy_in_usd} onChange={(e) => setForm({ ...form, buy_in_usd: e.target.value })} /></div>
              <div><Label>{t("internationalPage.fieldGuarantee")}</Label><Input type="number" value={form.guarantee_usd} onChange={(e) => setForm({ ...form, guarantee_usd: e.target.value })} /></div>
            </div>
            <div><Label>{t("internationalPage.fieldPosterUrl")}</Label><Input value={form.poster_url} onChange={(e) => setForm({ ...form, poster_url: e.target.value })} placeholder="https://..." /></div>
            <div><Label>{t("internationalPage.fieldWebsite")}</Label><Input value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} placeholder="https://..." /></div>
            <div><Label>{t("internationalPage.fieldDescription")}</Label><Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm"><Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /> {t("internationalPage.fieldVisible")}</label>
              <div className="flex items-center gap-2"><Label className="m-0">{t("internationalPage.fieldOrder")}</Label><Input type="number" className="w-20" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) || 0 })} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("internationalPage.cancel")}</Button>
              <Button onClick={save} disabled={saving} className="gradient-neon text-primary-foreground">
                {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} {t("internationalPage.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default InternationalEvents;
