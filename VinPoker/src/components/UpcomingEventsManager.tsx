import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, MapPin, Plus, Trash2, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { ProofUploader } from "./ProofUploader";

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

export const UpcomingEventsManager = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [events, setEvents] = useState<any[]>([]);
  const [proofs, setProofs] = useState<Map<string, any[]>>(new Map());
  const [open, setOpen] = useState(false);
  const [proofDialogId, setProofDialogId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(initial());
  const [saving, setSaving] = useState(false);

  function initial() {
    return {
      event_name: "",
      venue: "",
      event_date: "",
      buy_in: 0,
      selling_percentage: 20,
      markup: 1.0,
      notes: "",
      cover_url: null as string | null,
    };
  }

  const load = async () => {
    if (!user) return;
    const { data: ev } = await supabase
      .from("player_upcoming_events")
      .select("*")
      .eq("player_id", user.id)
      .order("event_date", { ascending: true });
    setEvents(ev ?? []);
    const ids = (ev ?? []).map((e: any) => e.id);
    if (ids.length) {
      const { data: pr } = await supabase.from("event_proofs").select("*").in("event_id", ids);
      const m = new Map<string, any[]>();
      (pr ?? []).forEach((p: any) => {
        const arr = m.get(p.event_id) ?? [];
        arr.push(p);
        m.set(p.event_id, arr);
      });
      setProofs(m);
    } else {
      setProofs(new Map());
    }
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const submit = async () => {
    if (!user) return;
    if (!form.event_name.trim() || !form.event_date) {
      toast.error(t("upcoming.needNameDate"));
      return;
    }
    if (!form.cover_url) {
      toast.error("Bắt buộc tải poster sự kiện");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("player_upcoming_events").insert({
      player_id: user.id,
      event_name: form.event_name.trim(),
      venue: form.venue.trim() || null,
      event_date: new Date(form.event_date).toISOString(),
      buy_in: Number(form.buy_in) || 0,
      selling_percentage: form.selling_percentage,
      markup: form.markup,
      notes: form.notes.trim() || null,
      cover_url: form.cover_url,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("upcoming.added"));
    setOpen(false);
    setForm(initial());
    load();
  };

  const remove = async (id: string) => {
    if (!confirm(t("upcoming.confirmDelete"))) return;
    const { error } = await supabase.from("player_upcoming_events").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(t("upcoming.deleted")); load(); }
  };

  const addProof = async (eventId: string, url: string) => {
    const { error } = await supabase.from("event_proofs").insert({ event_id: eventId, image_url: url });
    if (error) toast.error(error.message);
    else { toast.success(t("upcoming.proofAdded")); load(); }
  };

  const removeProof = async (proofId: string) => {
    const { error } = await supabase.from("event_proofs").delete().eq("id", proofId);
    if (error) toast.error(error.message);
    else load();
  };

  return (
    <Card className="p-4 space-y-3 border-primary/20">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">{t("upcoming.title")}</h3>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="w-3 h-3 mr-1" /> {t("upcoming.addEvent")}
        </Button>
      </div>

      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3 text-center">{t("upcoming.empty")}</p>
      ) : (
        <div className="space-y-2">
          {events.map((e) => {
            const eventProofs = proofs.get(e.id) ?? [];
            const markupColor = e.markup <= 1.0 ? "text-muted-foreground" : e.markup <= 1.3 ? "text-success" : "text-warning";
            return (
              <div key={e.id} className="rounded-lg border border-border/40 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="font-semibold text-sm">{e.event_name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(e.event_date).toLocaleDateString("vi-VN")}</span>
                      {e.venue && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{e.venue}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {e.buy_in > 0 && <Badge variant="outline" className="text-xs">{t("upcoming.buyIn")} {fmt(e.buy_in)} đ</Badge>}
                      <Badge className="bg-primary/20 text-primary border-primary/40 text-xs">{t("upcoming.selling", { n: e.selling_percentage })}</Badge>
                      <Badge variant="outline" className={`text-xs ${markupColor}`}>{t("upcoming.markup", { n: e.markup })}</Badge>
                    </div>
                    {e.notes && <p className="text-xs text-muted-foreground italic mt-1">"{e.notes}"</p>}
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(e.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>

                {/* Proofs */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border/30">
                  {eventProofs.map((p) => (
                    <div key={p.id} className="relative">
                      <img src={p.image_url} alt="" className="h-16 w-16 object-cover rounded border border-border" />
                      <button
                        onClick={() => removeProof(p.id)}
                        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setProofDialogId(e.id)}
                    className="h-16 w-16 rounded border-2 border-dashed border-border/60 flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    <ImagePlus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add event dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("upcoming.addDialogTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label={t("upcoming.eventName")}>
              <Input value={form.event_name} onChange={(e) => setForm({ ...form, event_name: e.target.value })} placeholder={t("upcoming.eventNamePh")} />
            </Field>
            <Field label={t("upcoming.venue")}>
              <Input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder={t("upcoming.venuePh")} />
            </Field>
            <Field label={t("upcoming.eventDate")}>
              <Input type="datetime-local" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
            </Field>
            <Field label={t("upcoming.buyInVnd")}>
              <Input type="number" value={form.buy_in} onChange={(e) => setForm({ ...form, buy_in: e.target.value })} />
            </Field>
            <Field label={t("upcoming.sellingLabel", { n: form.selling_percentage })}>
              <Slider min={5} max={80} step={5} value={[form.selling_percentage]} onValueChange={(v) => setForm({ ...form, selling_percentage: v[0] })} />
            </Field>
            <Field label={t("upcoming.markupLabel", { n: form.markup })}>
              <Slider min={1.0} max={2.0} step={0.05} value={[form.markup]} onValueChange={(v) => setForm({ ...form, markup: Number(v[0].toFixed(2)) })} />
            </Field>
            <Field label={t("upcoming.notes")}>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={300} />
            </Field>
            <Field label={t("upcoming.poster") + " *"}>
              <ProofUploader folder="upcoming/cover" value={form.cover_url} onChange={(url) => setForm({ ...form, cover_url: url })} required />
            </Field>
            <Button onClick={submit} disabled={saving || !form.cover_url} className="w-full">
              {saving ? t("upcoming.saving") : t("upcoming.submit")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add proof dialog */}
      <Dialog open={!!proofDialogId} onOpenChange={(o) => !o && setProofDialogId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t("upcoming.addProofTitle")}</DialogTitle></DialogHeader>
          <ProofUploader
            folder={`upcoming/${proofDialogId}`}
            onChange={(url) => {
              if (url && proofDialogId) {
                addProof(proofDialogId, url);
                setProofDialogId(null);
              }
            }}
            label={t("upcoming.proofUploadLabel")}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    {children}
  </div>
);
