import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Save, ChevronDown, ChevronRight, CalendarPlus, Loader2 } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { FomoPrice } from "@/components/FomoPrice";
import { LiveStateEditor } from "@/components/LiveStateEditor";
import { formatDateTime, formatVND } from "@/lib/format";

const GAME_TYPES = [
  { v: "nlh", l: "No Limit Hold'em" },
  { v: "plo", l: "Pot Limit Omaha" },
  { v: "mixed", l: "Mixed Games" },
];

type ClubRow = { id: string; name: string };

/**
 * Floor — tournament list management (create / edit / delete / status / live-state).
 * Moved from Club Admin so the floor owns the tournament list it operates on.
 * Frontend-only: plain `tournaments` table CRUD, no money/finance side effects beyond
 * the rake / service-fee fields the create/edit dialogs already wrote in Club Admin.
 * Scoped to the operator's clubs; multi-club picks the target club on create.
 */
export function TournamentManagerPanel({ clubIds, clubs }: { clubIds: string[]; clubs: ClubRow[] }) {
  const { t } = useTranslation();
  const [tours, setTours] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const clubNameMap = Object.fromEntries(clubs.map((c) => [c.id, c.name]));
  const multiClub = clubs.length > 1;

  const load = useCallback(async () => {
    if (!clubIds.length) {
      setTours([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("tournaments")
      .select("*")
      .in("club_id", clubIds)
      .order("start_time");
    if (error) toast.error(error.message);
    setTours(data ?? []);
    setLoading(false);
  }, [clubIds]);

  useEffect(() => { load(); }, [load]);

  const deleteTour = async (id: string) => {
    if (!confirm(t("clubAdmin.deleteConfirm"))) return;
    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(t("clubAdmin.tournamentDeleted")); load(); }
  };

  const setTourStatus = async (id: string, status: "scheduled" | "live" | "finished" | "cancelled") => {
    const { error } = await supabase.from("tournaments").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(t("clubAdmin.statusUpdated")); load(); }
  };

  return (
    <Card className="mb-4 border-primary/20">
      <div className="flex items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 min-w-0 text-left"
        >
          {expanded
            ? <ChevronDown className="w-4 h-4 text-primary shrink-0" />
            : <ChevronRight className="w-4 h-4 text-primary shrink-0" />}
          <CalendarPlus className="w-4 h-4 text-primary shrink-0" />
          <span className="font-display text-primary truncate">Quản lý giải đấu</span>
          <span className="text-xs text-muted-foreground">({tours.length})</span>
        </button>
        {clubIds.length > 0 && (
          <NewTournamentDialog clubs={clubs} defaultClubId={clubIds[0]} multiClub={multiClub} onCreated={load} />
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-3">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : tours.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("clubAdmin.noTournaments")}</p>
          ) : (
            <div className="max-h-[42vh] overflow-y-auto space-y-2 pr-1">
              {tours.map((t2) => (
                <Card key={t2.id} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{t2.name}</div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(t2.start_time)}</div>
                      <div className="mt-0.5"><FomoPrice tournament={t2} /></div>
                      <div className="text-[11px] text-muted-foreground">
                        {t("clubAdmin.stack")}: {t2.starting_stack?.toLocaleString?.() ?? t2.starting_stack}
                        {t2.location ? ` · 📍 ${t2.location}` : ""}
                        {multiClub && clubNameMap[t2.club_id] ? ` · 🏠 ${clubNameMap[t2.club_id]}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <EditTournamentDialog tournament={t2} onSaved={load} />
                      <Button variant="ghost" size="icon" onClick={() => deleteTour(t2.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <Select value={t2.status} onValueChange={(v) => setTourStatus(t2.id, v as any)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scheduled">{t("clubAdmin.scheduled")}</SelectItem>
                      <SelectItem value="live">{t("clubAdmin.live")}</SelectItem>
                      <SelectItem value="finished">{t("clubAdmin.finished")}</SelectItem>
                      <SelectItem value="cancelled">{t("clubAdmin.cancelled")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <LiveStateEditor tournament={t2} onSaved={load} />
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

const NewTournamentDialog = ({
  clubs, defaultClubId, multiClub, onCreated,
}: {
  clubs: ClubRow[]; defaultClubId: string; multiClub: boolean; onCreated: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [clubId, setClubId] = useState(defaultClubId);
  const [f, setF] = useState({ name: "", start_time: "", buy_in: 1000000, rake_amount: 0, service_fee_amount: 0, starting_stack: 20000, location: "", description: "", game_type: "nlh", minutes_per_level: 20, late_reg_close_level: 6 });
  useEffect(() => { setClubId(defaultClubId); }, [defaultClubId]);
  const submit = async () => {
    if (!f.name || !f.start_time) return toast.error("Please fill all required fields");
    if (!clubId) return toast.error("Chọn câu lạc bộ");
    const { error } = await supabase.from("tournaments").insert({
      club_id: clubId, name: f.name, start_time: new Date(f.start_time).toISOString(),
      buy_in: Number(f.buy_in), rake_amount: Number(f.rake_amount) || 0,
      ...(FEATURES.tournamentServiceFee ? { service_fee_amount: Number(f.service_fee_amount) || 0 } : {}),
      starting_stack: Number(f.starting_stack),
      location: f.location, description: f.description, game_type: f.game_type,
      minutes_per_level: Number(f.minutes_per_level), late_reg_close_level: Number(f.late_reg_close_level),
    });
    if (error) toast.error(error.message); else { toast.success("Tournament created"); setOpen(false); onCreated(); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="border-primary/50 text-primary"><Plus className="w-4 h-4 mr-1" />Tạo giải</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Tạo giải đấu</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {multiClub && (
            <>
              <Label>Câu lạc bộ</Label>
              <Select value={clubId} onValueChange={setClubId}>
                <SelectTrigger><SelectValue placeholder="Chọn CLB" /></SelectTrigger>
                <SelectContent>
                  {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          )}
          <Label>Name</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <Label>Start time</Label><Input type="datetime-local" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} />
          <Label>Game type</Label>
          <Select value={f.game_type} onValueChange={v => setF({ ...f, game_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {GAME_TYPES.map(g => <SelectItem key={g.v} value={g.v}>{g.l}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Buy-in (VND)</Label><Input type="number" value={f.buy_in} onChange={e => setF({ ...f, buy_in: +e.target.value })} /></div>
            <div><Label>Rake / phí giải (VND)</Label><Input type="number" value={f.rake_amount} onChange={e => setF({ ...f, rake_amount: +e.target.value })} /></div>
          </div>
          {FEATURES.tournamentServiceFee && (
            <div><Label>Phí dịch vụ (VND)</Label><Input type="number" value={f.service_fee_amount} onChange={e => setF({ ...f, service_fee_amount: +e.target.value })} /></div>
          )}
          <p className="text-xs text-muted-foreground -mt-1">Người chơi trả: <span className="text-primary font-medium">{formatVND((Number(f.buy_in) || 0) + (Number(f.rake_amount) || 0) + (FEATURES.tournamentServiceFee ? (Number(f.service_fee_amount) || 0) : 0))}</span> <span className="opacity-70">(buy-in + rake{FEATURES.tournamentServiceFee ? " + phí dịch vụ" : ""})</span></p>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Starting stack</Label><Input type="number" value={f.starting_stack} onChange={e => setF({ ...f, starting_stack: +e.target.value })} /></div>
            <div><Label>Minutes / level</Label><Input type="number" value={f.minutes_per_level} onChange={e => setF({ ...f, minutes_per_level: +e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Late reg close at level</Label><Input type="number" value={f.late_reg_close_level} onChange={e => setF({ ...f, late_reg_close_level: +e.target.value })} /></div>
            <div />
          </div>
          <Label>Location</Label><Input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} />
          <Label>Description</Label><Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
          <Button onClick={submit} className="w-full gradient-neon text-primary-foreground border-0">Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const EditTournamentDialog = ({ tournament, onSaved }: { tournament: any; onSaved: () => void }) => {
  const [open, setOpen] = useState(false);
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  };
  const [f, setF] = useState({
    name: tournament.name,
    start_time: toLocalInput(tournament.start_time),
    buy_in: tournament.buy_in,
    rake_amount: tournament.rake_amount ?? 0,
    service_fee_amount: tournament.service_fee_amount ?? 0,
    starting_stack: tournament.starting_stack,
    location: tournament.location ?? "",
    description: tournament.description ?? "",
    game_type: tournament.game_type ?? "nlh",
    minutes_per_level: tournament.minutes_per_level ?? 20,
    late_reg_close_level: tournament.late_reg_close_level ?? 6,
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!f.name || !f.start_time) return toast.error("Please fill all required fields");
    setSaving(true);
    const { error } = await supabase.from("tournaments").update({
      name: f.name,
      start_time: new Date(f.start_time).toISOString(),
      buy_in: Number(f.buy_in),
      rake_amount: Number(f.rake_amount) || 0,
      ...(FEATURES.tournamentServiceFee ? { service_fee_amount: Number(f.service_fee_amount) || 0 } : {}),
      starting_stack: Number(f.starting_stack),
      location: f.location,
      description: f.description,
      game_type: f.game_type,
      minutes_per_level: Number(f.minutes_per_level),
      late_reg_close_level: Number(f.late_reg_close_level),
    }).eq("id", tournament.id);
    setSaving(false);
    if (error) toast.error(error.message); else { toast.success("Saved"); setOpen(false); onSaved(); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon"><Pencil className="w-4 h-4 text-primary" /></Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Tournament</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Name</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <Label>Start time</Label><Input type="datetime-local" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} />
          <Label>Game type</Label>
          <Select value={f.game_type} onValueChange={v => setF({ ...f, game_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {GAME_TYPES.map(g => <SelectItem key={g.v} value={g.v}>{g.l}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Buy-in (VND)</Label><Input type="number" value={f.buy_in} onChange={e => setF({ ...f, buy_in: +e.target.value })} /></div>
            <div><Label>Rake / phí giải (VND)</Label><Input type="number" value={f.rake_amount} onChange={e => setF({ ...f, rake_amount: +e.target.value })} /></div>
          </div>
          {FEATURES.tournamentServiceFee && (
            <div><Label>Phí dịch vụ (VND)</Label><Input type="number" value={f.service_fee_amount} onChange={e => setF({ ...f, service_fee_amount: +e.target.value })} /></div>
          )}
          <p className="text-xs text-muted-foreground -mt-1">Người chơi trả: <span className="text-primary font-medium">{formatVND((Number(f.buy_in) || 0) + (Number(f.rake_amount) || 0) + (FEATURES.tournamentServiceFee ? (Number(f.service_fee_amount) || 0) : 0))}</span> <span className="opacity-70">(buy-in + rake{FEATURES.tournamentServiceFee ? " + phí dịch vụ" : ""})</span></p>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Starting stack</Label><Input type="number" value={f.starting_stack} onChange={e => setF({ ...f, starting_stack: +e.target.value })} /></div>
            <div><Label>Minutes / level</Label><Input type="number" value={f.minutes_per_level} onChange={e => setF({ ...f, minutes_per_level: +e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Late reg close at level</Label><Input type="number" value={f.late_reg_close_level} onChange={e => setF({ ...f, late_reg_close_level: +e.target.value })} /></div>
            <div />
          </div>
          <Label>Location</Label><Input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} />
          <Label>Description</Label><Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={2} />
          <Button onClick={save} disabled={saving} className="w-full gradient-neon text-primary-foreground border-0">
            <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
