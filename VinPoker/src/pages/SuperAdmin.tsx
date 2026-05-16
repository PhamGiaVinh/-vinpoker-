import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { Loader2, Check, X, Shield, Plus, Trash2, Save, Pencil, Image as ImageIcon, Upload, Wand2 } from "lucide-react";
import { formatDateTime, formatVND } from "@/lib/format";
import { LiveStateEditor } from "@/components/LiveStateEditor";
import { BackingReviewQueue } from "@/components/BackingReviewQueue";
import { SpreadPnL } from "@/components/admin/SpreadPnL";
import { AdminSupportTab } from "@/components/admin/AdminSupportTab";
import { AdminStreamManager } from "@/components/admin/AdminStreamManager";

const REGIONS = ["TP.HCM", "Hanoi", "Da Nang", "Hai Phong", "Can Tho"];
const GAME_TYPES = [{v:"nlh",l:"No Limit Hold'em"},{v:"plo",l:"Pot Limit Omaha"},{v:"mixed",l:"Mixed Games"}];

type TournamentStatus = "scheduled" | "live" | "finished" | "cancelled";

const SuperAdmin = () => {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [clubs, setClubs] = useState<any[]>([]);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [regs, setRegs] = useState<any[]>([]);

  const load = async () => {
    if (!initialLoaded) setBusy(true);
    try {
      try {
        await supabase.rpc("auto_soft_delete_old_tournaments");
      } catch (e) { console.error("auto-soft-delete tournaments failed", e); }

      const [clubsRes, toursRes, regsRes] = await Promise.all([
        supabase.from("clubs").select("*").order("created_at", { ascending: false }),
        supabase.from("tournaments").select("*, club:clubs(name)").is("deleted_at", null).order("start_time", { ascending: false }),
        supabase.from("stack_registrations")
          .select("*, tournament:tournaments(name, start_time, club:clubs(name))")
          .order("created_at", { ascending: false }),
      ]);
      if (clubsRes.error) { console.error("clubs load error", clubsRes.error); toast.error("Lỗi tải clubs: " + clubsRes.error.message); }
      if (toursRes.error) { console.error("tournaments load error", toursRes.error); }
      if (regsRes.error) { console.error("regs load error", regsRes.error); }
      setClubs(clubsRes.data ?? []);
      setTournaments(toursRes.data ?? []);

      const r = regsRes.data ?? [];
      const userIds = Array.from(new Set(r.map((x: any) => x.user_id)));
      let profileMap: Record<string, any> = {};
      if (userIds.length) {
        const { data: profs } = await supabase.from("profiles").select("user_id, display_name, phone").in("user_id", userIds);
        profileMap = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p]));
      }
      setRegs(r.map((x: any) => ({ ...x, profile: profileMap[x.user_id] })));
    } catch (e: any) {
      console.error("SuperAdmin load failed", e);
      toast.error("Lỗi tải Admin: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
      setInitialLoaded(true);
    }
  };

  useEffect(() => { if (isAdmin) load(); else if (!loading) setBusy(false); }, [isAdmin, loading]);

  if (loading || busy) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) return (
    <Card className="p-6 text-center">
      <Shield className="w-10 h-10 mx-auto text-destructive mb-2" />
      <h2 className="font-display text-lg">No Access</h2>
      <p className="text-sm text-muted-foreground">Super Admin access is required.</p>
    </Card>
  );

  const setClubStatus = async (id: string, status: "approved" | "rejected") => {
    const { error } = await supabase.from("clubs").update({ status }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Updated"); load(); }
  };

  const setRegStatus = async (id: string, status: "confirmed" | "rejected") => {
    const { error } = await supabase.from("stack_registrations").update({ status }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Updated"); load(); }
  };

  const setTourStatus = async (id: string, status: TournamentStatus) => {
    const { error } = await supabase.from("tournaments").update({ status }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Tournament status updated"); load(); }
  };

  const deleteTour = async (id: string) => {
    if (!confirm("Delete this tournament?")) return;
    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl text-primary">Super Admin</h1>
        <p className="text-xs text-muted-foreground">Full system control for VBacker.</p>
      </div>

      <Tabs defaultValue="tournaments">
        <TabsList className="flex w-full overflow-x-auto justify-start md:grid md:grid-cols-9">
          <TabsTrigger value="tournaments">Tournaments</TabsTrigger>
          <TabsTrigger value="series">Series</TabsTrigger>
          <TabsTrigger value="registrations">Registrations</TabsTrigger>
          <TabsTrigger value="clubs">Clubs</TabsTrigger>
          <TabsTrigger value="backing">Backing</TabsTrigger>
          <TabsTrigger value="banners">Banners</TabsTrigger>
          <TabsTrigger value="pnl">P&L Spread</TabsTrigger>
          <TabsTrigger value="streams">Livestream</TabsTrigger>
          <TabsTrigger value="support">Hỗ trợ</TabsTrigger>
        </TabsList>


        <TabsContent value="pnl" className="mt-4"><SpreadPnL /></TabsContent>

        {/* TOURNAMENTS */}
        <TabsContent value="tournaments" className="space-y-3 mt-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/admin/tournaments/bulk-create")}>
              <Wand2 className="h-4 w-4 mr-1" /> Tạo hàng loạt từ ảnh
            </Button>
            <NewTournamentDialog clubs={clubs} onCreated={load} />
          </div>
          {tournaments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tournaments yet.</p>
          ) : tournaments.map(t => (
            <Card key={t.id} className="p-3 gradient-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.club?.name} · {formatDateTime(t.start_time)}</div>
                  <div className="text-xs text-neon mt-0.5">Buy-in: {formatVND(t.buy_in)} · Stack: {t.starting_stack.toLocaleString()}</div>
                  {t.location && <div className="text-xs text-muted-foreground">📍 {t.location}</div>}
                </div>
                <div className="flex gap-1">
                  <EditTournamentDialog tournament={t} onSaved={load} />
                  <Button variant="ghost" size="icon" onClick={() => deleteTour(t.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Select value={t.status} onValueChange={(v) => setTourStatus(t.id, v as TournamentStatus)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="finished">Finished</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="mt-2">
                <LiveStateEditor tournament={t} onSaved={load} />
              </div>
            </Card>
          ))}
        </TabsContent>

        {/* REGISTRATIONS */}
        <TabsContent value="registrations" className="space-y-3 mt-4">
          {regs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No registrations yet.</p>
          ) : regs.map(r => (
            <Card key={r.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{r.profile?.display_name || "Player"}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.tournament?.name} · {r.tournament?.club?.name}
                  </div>
                  {r.profile?.phone && <div className="text-xs text-gold">{r.profile.phone}</div>}
                  {r.note && <div className="text-xs text-muted-foreground mt-1 italic">"{r.note}"</div>}
                </div>
                <StatusBadge status={r.status} />
              </div>
              {r.status === "pending" && (
                <div className="flex gap-2 mt-2">
                  <Button size="sm" className="flex-1 bg-success text-success-foreground hover:bg-success/90" onClick={() => setRegStatus(r.id, "confirmed")}>
                    <Check className="w-4 h-4 mr-1" />Approve
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setRegStatus(r.id, "rejected")}>
                    <X className="w-4 h-4 mr-1" />Reject
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </TabsContent>

        {/* CLUBS - approve + create */}
        <TabsContent value="clubs" className="space-y-3 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Create new clubs and manage descriptions / weekly schedules.</p>
            <NewClubDialog onCreated={load} />
          </div>
          {clubs.map(c => (
            <ClubSettingsCard key={c.id} club={c} onChanged={load} onApprove={setClubStatus} />
          ))}
        </TabsContent>


        {/* MULTI BANNERS carousel editor */}
        <TabsContent value="banners" className="mt-4">
          <BannersEditor />
        </TabsContent>

        {/* SERIES management */}
        <TabsContent value="series" className="mt-4">
          <SeriesEditor />
        </TabsContent>

        {/* BACKING review queue */}
        <TabsContent value="backing" className="mt-4">
          <BackingReviewQueue />
        </TabsContent>

        <TabsContent value="streams" className="mt-4">
          <AdminStreamManager />
        </TabsContent>

        <TabsContent value="support" className="mt-4">
          <AdminSupportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

const ClubSettingsCard = ({ club, onChanged, onApprove }: { club: any; onChanged: () => void; onApprove: (id: string, s: "approved" | "rejected") => void }) => {
  const { isAdmin } = useAuth();
  const [f, setF] = useState({ name: club.name, address: club.address ?? "", region: club.region, description: club.description ?? "", schedule: club.schedule ?? "" });
  const [logoUrl, setLogoUrl] = useState<string | null>(club.cover_url ?? null);
  const [dailyImg, setDailyImg] = useState<string | null>(club.daily_schedule_image_url ?? null);
  const [weeklyImg, setWeeklyImg] = useState<string | null>(club.weekly_schedule_image_url ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadingSchedule, setUploadingSchedule] = useState<"daily" | "weekly" | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const onPickSchedule = async (e: React.ChangeEvent<HTMLInputElement>, kind: "daily" | "weekly") => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please select an image file");
    if (file.size > 8 * 1024 * 1024) return toast.error("Image must be smaller than 8MB");
    setUploadingSchedule(kind);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `club-schedules/${club.id}-${kind}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("app-assets").upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) { setUploadingSchedule(null); return toast.error(upErr.message); }
    const url = supabase.storage.from("app-assets").getPublicUrl(path).data.publicUrl;
    const updates = kind === "daily" ? { daily_schedule_image_url: url } : { weekly_schedule_image_url: url };
    const { error: updErr } = await supabase.from("clubs").update(updates).eq("id", club.id);
    setUploadingSchedule(null);
    if (updErr) return toast.error(updErr.message);
    if (kind === "daily") setDailyImg(url); else setWeeklyImg(url);
    toast.success(`${kind === "daily" ? "Daily" : "Weekly"} schedule updated`);
    onChanged();
  };

  const removeSchedule = async (kind: "daily" | "weekly") => {
    const updates = kind === "daily" ? { daily_schedule_image_url: null } : { weekly_schedule_image_url: null };
    const { error } = await supabase.from("clubs").update(updates).eq("id", club.id);
    if (error) return toast.error(error.message);
    if (kind === "daily") setDailyImg(null); else setWeeklyImg(null);
    toast.success("Removed");
    onChanged();
  };

  const onPickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please select an image file");
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be smaller than 5MB");
    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `club-logos/${club.id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("app-assets").upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) { setUploading(false); return toast.error(upErr.message); }
    const { data: pub } = supabase.storage.from("app-assets").getPublicUrl(path);
    const url = pub.publicUrl;
    const { error: updErr } = await supabase.from("clubs").update({ cover_url: url }).eq("id", club.id);
    setUploading(false);
    if (updErr) return toast.error(updErr.message);
    setLogoUrl(url);
    toast.success("Logo updated");
    onChanged();
  };

  const removeLogo = async () => {
    const { error } = await supabase.from("clubs").update({ cover_url: null }).eq("id", club.id);
    if (error) return toast.error(error.message);
    setLogoUrl(null);
    toast.success("Logo removed");
    onChanged();
  };

  const save = async () => {
    if (!f.name.trim()) return toast.error("Club name is required");
    setSaving(true);
    const { error } = await supabase.from("clubs").update({
      name: f.name.trim(),
      address: f.address,
      region: f.region,
      description: f.description,
      schedule: f.schedule,
    }).eq("id", club.id);
    setSaving(false);
    if (error) toast.error(error.message); else { toast.success("Saved"); onChanged(); }
  };
  const remove = async () => {
    if (!confirm(`Delete club "${club.name}"? All its tournaments and bookings stay but lose their parent. This cannot be undone.`)) return;
    setDeleting(true);
    const { error } = await supabase.from("clubs").delete().eq("id", club.id);
    setDeleting(false);
    if (error) toast.error(error.message); else { toast.success("Club deleted"); onChanged(); }
  };
  return (
    <Card className="p-4 gradient-card space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Label className="text-xs">Club name</Label>
          <Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="font-semibold" />
          <p className="text-xs text-muted-foreground mt-1">{club.address} · {club.region}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${club.status === "approved" ? "bg-success/15 text-success border-success/30" : club.status === "pending" ? "bg-warning/15 text-warning border-warning/30" : "bg-destructive/15 text-destructive border-destructive/30"}`}>{club.status}</span>
          {isAdmin && (
            <Button variant="ghost" size="icon" onClick={remove} disabled={deleting} title="Delete club">
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      {/* LOGO uploader */}
      <div className="flex items-center gap-3 p-2 rounded-lg border border-border/60 bg-background/40">
        <div className="w-14 h-14 rounded-lg overflow-hidden bg-background border border-border flex items-center justify-center shrink-0">
          {logoUrl ? (
            <img src={logoUrl} alt={`${club.name} logo`} className="w-full h-full object-cover" />
          ) : (
            <ImageIcon className="w-6 h-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <Label className="text-xs">Club logo</Label>
          <div className="flex items-center gap-2 mt-1">
            <label className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border cursor-pointer hover:bg-accent">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? "Uploading..." : (logoUrl ? "Change" : "Upload")}
              <input type="file" accept="image/*" className="hidden" onChange={onPickLogo} disabled={uploading} />
            </label>
            {logoUrl && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={removeLogo}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {club.status === "pending" && (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1 bg-success text-success-foreground hover:bg-success/90" onClick={() => onApprove(club.id, "approved")}><Check className="w-4 h-4 mr-1" />Approve</Button>
          <Button size="sm" variant="outline" className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => onApprove(club.id, "rejected")}><X className="w-4 h-4 mr-1" />Reject</Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Address</Label>
          <Input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Region</Label>
          <Select value={f.region} onValueChange={v => setF({ ...f, region: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={2} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Weekly schedule (text - legacy)</Label>
        <Textarea value={f.schedule} onChange={e => setF({ ...f, schedule: e.target.value })} rows={2} placeholder={"Mon-Fri: 19:00 - 02:00\nSat-Sun: 14:00 - 03:00"} />
      </div>

      {/* Schedule images */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {(["daily", "weekly"] as const).map((kind) => {
          const url = kind === "daily" ? dailyImg : weeklyImg;
          const busy = uploadingSchedule === kind;
          return (
            <div key={kind} className="p-2 rounded-lg border border-border/60 bg-background/40 space-y-2">
              <Label className="text-xs">{kind === "daily" ? "Ảnh lịch hàng ngày" : "Ảnh lịch hàng tuần"}</Label>
              {url ? (
                <div className="relative">
                  <img src={url} alt={`${kind} schedule`} className="w-full max-h-64 object-contain rounded-md border border-border bg-background" />
                </div>
              ) : (
                <div className="h-24 rounded-md border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">
                  Chưa có ảnh
                </div>
              )}
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border cursor-pointer hover:bg-accent">
                  <Upload className="w-3.5 h-3.5" />
                  {busy ? "Uploading..." : (url ? "Đổi ảnh" : "Tải lên")}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => onPickSchedule(e, kind)} disabled={busy} />
                </label>
                {url && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => removeSchedule(kind)}>
                    Xoá
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Button size="sm" onClick={save} disabled={saving} className="gradient-neon text-primary-foreground border-0">
        <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save changes"}
      </Button>
    </Card>
  );
};

const NewTournamentDialog = ({ clubs, onCreated }: { clubs: any[]; onCreated: () => void }) => {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ club_id: "", name: "", start_time: "", buy_in: 1000000, starting_stack: 20000, location: "", description: "", game_type: "nlh" });
  const submit = async () => {
    if (!f.club_id || !f.name || !f.start_time) return toast.error("Please fill all required fields");
    const { error } = await supabase.from("tournaments").insert({
      club_id: f.club_id, name: f.name, start_time: new Date(f.start_time).toISOString(),
      buy_in: Number(f.buy_in), starting_stack: Number(f.starting_stack),
      location: f.location, description: f.description, game_type: f.game_type,
    });
    if (error) toast.error(error.message); else { toast.success("Tournament created"); setOpen(false); onCreated(); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gradient-neon text-primary-foreground border-0">
          <Plus className="w-4 h-4 mr-1" />New Tournament
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Tournament</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Club</Label>
          <Select value={f.club_id} onValueChange={v => setF({ ...f, club_id: v })}>
            <SelectTrigger><SelectValue placeholder="Select club" /></SelectTrigger>
            <SelectContent>
              {clubs.filter(c => c.status === "approved").map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Label>Name</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <Label>Start time</Label><Input type="datetime-local" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} />
          <Label>Game type</Label>
          <Select value={f.game_type} onValueChange={v => setF({ ...f, game_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{GAME_TYPES.map(g => <SelectItem key={g.v} value={g.v}>{g.l}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Buy-in (VND)</Label><Input type="number" value={f.buy_in} onChange={e => setF({ ...f, buy_in: +e.target.value })} /></div>
            <div><Label>Starting stack</Label><Input type="number" value={f.starting_stack} onChange={e => setF({ ...f, starting_stack: +e.target.value })} /></div>
          </div>
          <Label>Location</Label><Input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} />
          <Label>Description</Label><Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
          <Button onClick={submit} className="w-full gradient-neon text-primary-foreground border-0">Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const NewClubDialog = ({ onCreated }: { onCreated: () => void }) => {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", address: "", region: "TP.HCM", description: "", schedule: "", owner_id: "" });
  const submit = async () => {
    if (!f.name) return toast.error("Club name is required");
    const payload: any = { name: f.name, address: f.address, region: f.region, description: f.description, schedule: f.schedule, status: "approved" };
    if (f.owner_id.trim()) payload.owner_id = f.owner_id.trim();
    const { error } = await supabase.from("clubs").insert(payload);
    if (error) toast.error(error.message); else { toast.success("Club created"); setOpen(false); onCreated(); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gradient-neon text-primary-foreground border-0">
          <Plus className="w-4 h-4 mr-1" />New Club
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Club</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Name</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <Label>Address</Label><Input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} />
          <Label>Region</Label>
          <Select value={f.region} onValueChange={v => setF({ ...f, region: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
          <Label>Schedule</Label><Input value={f.schedule} onChange={e => setF({ ...f, schedule: e.target.value })} />
          <Label>Description</Label><Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
          <Label>Owner User ID (optional)</Label>
          <Input placeholder="UUID of the club_admin owner" value={f.owner_id} onChange={e => setF({ ...f, owner_id: e.target.value })} />
          <p className="text-[10px] text-muted-foreground">Leave blank to assign later from the Users page.</p>
          <Button onClick={submit} className="w-full gradient-neon text-primary-foreground border-0">Create Club</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const VipBannerEditor = () => {
  const [f, setF] = useState({ title: "", subtitle: "", image_url: "", cta_url: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "vip_banner").maybeSingle();
      if (data?.value) setF({ title: "", subtitle: "", image_url: "", cta_url: "", ...(data.value as any) });
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("app_settings")
      .upsert({ key: "vip_banner", value: f as any, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("VIP banner updated");
  };

  const onUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Image only");
    if (file.size > 5 * 1024 * 1024) return toast.error("Max 5MB");
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `vip-banner/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("app-assets").upload(path, file, { upsert: true });
    if (error) { setUploading(false); return toast.error(error.message); }
    const { data } = supabase.storage.from("app-assets").getPublicUrl(path);
    setF(prev => ({ ...prev, image_url: data.publicUrl }));
    setUploading(false);
    toast.success("Image uploaded — remember to Save");
  };

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;

  return (
    <Card className="p-4 gradient-card space-y-3">
      <div className="flex items-center gap-2">
        <ImageIcon className="w-5 h-5 text-primary" />
        <h3 className="font-display text-lg">VIP Main Event Banner</h3>
      </div>
      <p className="text-xs text-muted-foreground">Shown on the schedule page. Upload an image and customize copy.</p>

      {f.image_url && (
        <div className="rounded-lg overflow-hidden border border-border aspect-[16/5]">
          <img src={f.image_url} alt="banner preview" className="w-full h-full object-cover" />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Title</Label>
        <Input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="VIP Main Event" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Subtitle</Label>
        <Input value={f.subtitle} onChange={e => setF({ ...f, subtitle: e.target.value })} placeholder="$1M GTD · Coming Soon" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">CTA URL (optional)</Label>
        <Input value={f.cta_url} onChange={e => setF({ ...f, cta_url: e.target.value })} placeholder="https://..." />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Image URL</Label>
        <Input value={f.image_url} onChange={e => setF({ ...f, image_url: e.target.value })} placeholder="https://... or upload" />
      </div>

      <div className="flex gap-2">
        <label className="flex-1">
          <input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
          <Button asChild variant="outline" className="w-full border-primary/40 text-primary cursor-pointer">
            <span><Upload className="w-4 h-4 mr-1" />{uploading ? "Uploading..." : "Upload image"}</span>
          </Button>
        </label>
        <Button onClick={save} disabled={saving} className="flex-1 gradient-neon text-primary-foreground border-0">
          <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </Card>
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
    starting_stack: tournament.starting_stack,
    location: tournament.location ?? "",
    description: tournament.description ?? "",
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
      starting_stack: Number(f.starting_stack),
      location: f.location,
      description: f.description,
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
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Tournament</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Tournament Name</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <Label>Start Time</Label><Input type="datetime-local" value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Buy-in (VND)</Label><Input type="number" value={f.buy_in} onChange={e => setF({ ...f, buy_in: +e.target.value })} /></div>
            <div><Label>Starting Stack</Label><Input type="number" value={f.starting_stack} onChange={e => setF({ ...f, starting_stack: +e.target.value })} /></div>
          </div>
          <Label>Location</Label><Input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Phút / Level</Label><Input type="number" min={1} value={f.minutes_per_level} onChange={e => setF({ ...f, minutes_per_level: +e.target.value })} /></div>
            <div><Label>Đóng buy-in tại Level</Label><Input type="number" min={1} value={f.late_reg_close_level} onChange={e => setF({ ...f, late_reg_close_level: +e.target.value })} /></div>
          </div>
          <Label>Description</Label><Textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={2} />
          <Button onClick={save} disabled={saving} className="w-full gradient-neon text-primary-foreground border-0">
            <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

type BannerItem = { id: string; title: string; subtitle: string; image_url: string; cta_url: string };

export const BannersEditor = () => {
  const [items, setItems] = useState<BannerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "banners").maybeSingle();
      const raw = (data?.value as any)?.items;
      setItems(Array.isArray(raw) ? raw : []);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("app_settings")
      .upsert({ key: "banners", value: { items } as any, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Banners saved");
  };

  const addBanner = () => {
    setItems(prev => [...prev, { id: crypto.randomUUID(), title: "", subtitle: "", image_url: "", cta_url: "" }]);
  };
  const removeBanner = (id: string) => setItems(prev => prev.filter(b => b.id !== id));
  const updateBanner = (id: string, patch: Partial<BannerItem>) =>
    setItems(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));

  const upload = async (id: string, file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Image only");
    if (file.size > 5 * 1024 * 1024) return toast.error("Max 5MB");
    setUploadingId(id);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `banners/${id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("app-assets").upload(path, file, { upsert: true });
    if (error) { setUploadingId(null); return toast.error(error.message); }
    const { data } = supabase.storage.from("app-assets").getPublicUrl(path);
    updateBanner(id, { image_url: data.publicUrl });
    setUploadingId(null);
    toast.success("Uploaded — remember to Save All");
  };

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;

  return (
    <Card className="p-4 gradient-card space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg flex items-center gap-2"><ImageIcon className="w-5 h-5 text-primary" />Rotating Banners</h3>
          <p className="text-xs text-muted-foreground">Multiple promotional banners auto-cycle on the schedule page.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="border-primary/40 text-primary" onClick={addBanner}>
            <Plus className="w-4 h-4 mr-1" />Add banner
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="gradient-neon text-primary-foreground border-0">
            <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save All"}
          </Button>
        </div>
      </div>

      {items.length === 0 && (
        <p className="text-xs text-muted-foreground py-6 text-center">No banners yet. Click "Add banner" to create one.</p>
      )}

      <div className="space-y-3">
        {items.map((b, idx) => (
          <Card key={b.id} className="p-3 bg-background/50 space-y-2 border-primary/20">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground font-bold">Banner #{idx + 1}</div>
              <Button variant="ghost" size="icon" onClick={() => removeBanner(b.id)} title="Remove">
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
            {b.image_url && (
              <div className="rounded-lg overflow-hidden border border-border aspect-[16/5]">
                <img src={b.image_url} alt={b.title} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Title</Label><Input value={b.title} onChange={e => updateBanner(b.id, { title: e.target.value })} /></div>
              <div><Label className="text-xs">Subtitle</Label><Input value={b.subtitle} onChange={e => updateBanner(b.id, { subtitle: e.target.value })} /></div>
            </div>
            <div><Label className="text-xs">CTA URL (optional)</Label><Input value={b.cta_url} onChange={e => updateBanner(b.id, { cta_url: e.target.value })} placeholder="https://..." /></div>
            <div><Label className="text-xs">Image URL</Label><Input value={b.image_url} onChange={e => updateBanner(b.id, { image_url: e.target.value })} placeholder="https://... or upload" /></div>
            <label>
              <input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && upload(b.id, e.target.files[0])} />
              <Button asChild variant="outline" size="sm" className="border-primary/40 text-primary cursor-pointer">
                <span><Upload className="w-4 h-4 mr-1" />{uploadingId === b.id ? "Uploading..." : "Upload image"}</span>
              </Button>
            </label>
          </Card>
        ))}
      </div>
    </Card>
  );
};

type SeriesRow = { id: string; name: string; description: string | null; location: string | null; start_date: string; end_date: string; cover_url: string | null; status: string };

export const SeriesEditor = () => {
  const [items, setItems] = useState<SeriesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SeriesRow | null>(null);
  const blank: any = { name: "", description: "", location: "", start_date: "", end_date: "", cover_url: "", status: "upcoming" };
  const [f, setF] = useState<any>(blank);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("tournament_series").select("*").order("start_date", { ascending: false });
    setItems((data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setF(blank); setOpen(true); };
  const startEdit = (s: SeriesRow) => { setEditing(s); setF({ ...s, description: s.description ?? "", location: s.location ?? "", cover_url: s.cover_url ?? "" }); setOpen(true); };

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Image only");
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `series/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("app-assets").upload(path, file, { upsert: true });
    if (error) { setUploading(false); return toast.error(error.message); }
    const { data } = supabase.storage.from("app-assets").getPublicUrl(path);
    setF((p: any) => ({ ...p, cover_url: data.publicUrl }));
    setUploading(false);
  };

  const submit = async () => {
    if (!f.name || !f.start_date || !f.end_date) return toast.error("Name + dates required");
    const payload = { name: f.name, description: f.description, location: f.location, start_date: f.start_date, end_date: f.end_date, cover_url: f.cover_url || null, status: f.status };
    const { error } = editing
      ? await supabase.from("tournament_series").update(payload).eq("id", editing.id)
      : await supabase.from("tournament_series").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Saved"); setOpen(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this series and all its articles?")) return;
    const { error } = await supabase.from("tournament_series").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  };

  return (
    <Card className="p-4 gradient-card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg">International Series</h3>
          <p className="text-xs text-muted-foreground">Multi-day series like WSOP, APT, WPT.</p>
        </div>
        <Button size="sm" onClick={startNew} className="gradient-neon text-primary-foreground border-0"><Plus className="w-4 h-4 mr-1" />New Series</Button>
      </div>

      {loading ? <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> : items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">No series yet.</p>
      ) : items.map((s) => (
        <Card key={s.id} className="p-3 bg-background/50 flex items-center gap-3">
          <div className="w-14 h-14 rounded bg-muted overflow-hidden shrink-0">
            {s.cover_url && <img src={s.cover_url} alt={s.name} className="w-full h-full object-cover" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{s.name}</div>
            <div className="text-xs text-muted-foreground">{s.start_date} → {s.end_date}{s.location ? ` · ${s.location}` : ""}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => startEdit(s)}><Pencil className="w-4 h-4 text-primary" /></Button>
          <Button variant="ghost" size="icon" onClick={() => remove(s.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
        </Card>
      ))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Series" : "New Series"}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Start date</Label><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></div>
              <div><Label>End date</Label><Input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></div>
            </div>
            <Label>Location</Label><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
            <Label>Description</Label><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <Label>Cover image URL</Label><Input value={f.cover_url} onChange={(e) => setF({ ...f, cover_url: e.target.value })} />
            <label>
              <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button asChild variant="outline" size="sm" className="border-primary/40 text-primary cursor-pointer">
                <span><Upload className="w-4 h-4 mr-1" />{uploading ? "Uploading..." : "Upload cover"}</span>
              </Button>
            </label>
            <Button onClick={submit} className="w-full gradient-neon text-primary-foreground border-0"><Save className="w-4 h-4 mr-1" />Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default SuperAdmin;

