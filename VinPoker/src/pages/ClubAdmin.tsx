import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { Loader2, Plus, Check, X, Building2, Trash2, MessageCircle, FileSpreadsheet, Pencil, Save, Sparkles, ChevronDown, ChevronRight, Wallet, ShieldCheck } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { FomoPrice } from "@/components/FomoPrice";
import * as XLSX from "xlsx";
import { formatDateTime, formatVND } from "@/lib/format";
import { LiveStateEditor } from "@/components/LiveStateEditor";
import { ClubBotConfig } from "@/components/ClubBotConfig";
import { ClubBankAccountManager } from "@/components/ClubBankAccountManager";
import { StreamLinkManager } from "@/components/admin/StreamLinkManager";

const REGIONS = ["TP.HCM", "Hanoi", "Da Nang", "Hai Phong", "Can Tho"];
const GAME_TYPES = [{v:"nlh",l:"No Limit Hold'em"},{v:"plo",l:"Pot Limit Omaha"},{v:"mixed",l:"Mixed Games"}];

const ClubAdmin = () => {
  const { t } = useTranslation();

  const { user, loading: authLoading, isClubAdmin, isClubOwner } = useAuth();
  const nav = useNavigate();
  const [clubs, setClubs] = useState<any[]>([]);
  const [activeClub, setActiveClub] = useState<any>(null);
  const [tours, setTours] = useState<any[]>([]);
  const [regs, setRegs] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [profileLogs, setProfileLogs] = useState<any[]>([]);
  const [dealerShifts, setDealerShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadClubs = async () => {
    if (!user) return;
    const { data } = await supabase.from("clubs").select("*").eq("owner_id", user.id);
    setClubs(data ?? []);
    if (data?.[0] && !activeClub) setActiveClub(data[0]);
    setLoading(false);
  };

  const loadClubData = async (clubId: string) => {
    const { data: t } = await supabase.from("tournaments").select("*").eq("club_id", clubId).order("start_time");
    setTours(t ?? []);
    const ids = (t ?? []).map(x => x.id);
    const tourMap = Object.fromEntries((t ?? []).map((x: any) => [x.id, x]));
    if (ids.length) {
      const { data: r } = await supabase.from("stack_registrations")
        .select("*")
        .in("tournament_id", ids).order("created_at", { ascending: false });
      const userIds = Array.from(new Set((r ?? []).map((x: any) => x.user_id)));
      let pmap: Record<string, any> = {};
      if (userIds.length) {
        const { data: profs } = await supabase.from("profiles").select("user_id,display_name,phone").in("user_id", userIds);
        pmap = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p]));
      }
      setRegs((r ?? []).map((x: any) => ({ ...x, profile: pmap[x.user_id], tournament: tourMap[x.tournament_id] })));
    } else setRegs([]);

    // Booking chat requests for this club
    const { data: bc } = await supabase.from("booking_chats")
      .select("*")
      .eq("club_id", clubId)
      .order("updated_at", { ascending: false });
    const playerIds = Array.from(new Set((bc ?? []).map((b: any) => b.player_id)));
    let pmap: Record<string, any> = {};
    if (playerIds.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id,display_name,phone").in("user_id", playerIds);
      pmap = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p]));
    }
    setBookings((bc ?? []).map((b: any) => ({ ...b, player: pmap[b.player_id], tournament: tourMap[b.tournament_id] })));

    // Profile update logs for this club
    const { data: logs } = await (supabase as any)
      .from("profile_update_log")
      .select("*")
      .eq("club_id", clubId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (logs) {
      const logPlayerIds = Array.from(new Set((logs as any[]).map((l: any) => l.user_id)));
      let lpmap: Record<string, any> = {};
      if (logPlayerIds.length) {
        const { data: lprofs } = await supabase.from("profiles").select("user_id,display_name,phone").in("user_id", logPlayerIds);
        lpmap = Object.fromEntries((lprofs ?? []).map((p: any) => [p.user_id, p]));
      }
      setProfileLogs((logs as any[]).map((l: any) => ({ ...l, player: lpmap[l.user_id] })));
    }

    // Dealer shifts (tours) for this club
    const { data: shifts } = await supabase
      .from("dealer_shifts")
      .select("*")
      .eq("club_id", clubId)
      .order("start_time");
    setDealerShifts(shifts ?? []);
  };

  useEffect(() => { if (!authLoading) loadClubs(); }, [user?.id, authLoading]);
  useEffect(() => { if (activeClub) loadClubData(activeClub.id); }, [activeClub?.id]);

  // Realtime: refresh registrations & bookings when chats / payments change
  useEffect(() => {
    if (!activeClub?.id) return;
    const ch = supabase.channel(`club-admin-${activeClub.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "stack_registrations" }, () => loadClubData(activeClub.id))
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_chats", filter: `club_id=eq.${activeClub.id}` }, () => loadClubData(activeClub.id))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClub?.id]);

  if (authLoading || loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) { nav("/auth"); return null; }

  const updateReg = async (id: string, status: "confirmed" | "rejected") => {
    const patch: any = { status };
    if (status === "confirmed") { patch.checked_in_by = user!.id; patch.checked_in_at = new Date().toISOString(); }
    if (status === "rejected") { patch.cancelled_by = user!.id; patch.cancelled_at = new Date().toISOString(); }
    const { error } = await supabase.from("stack_registrations").update(patch).eq("id", id);
    if (error) toast.error(error.message); else { toast.success(t("clubAdmin.tournamentSaved")); loadClubData(activeClub.id); }
  };

  const deleteTour = async (id: string) => {
    if (!confirm(t("clubAdmin.deleteConfirm"))) return;
    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success(t("clubAdmin.tournamentDeleted")); loadClubData(activeClub.id); }
  };

  const setTourStatus = async (id: string, status: "scheduled" | "live" | "finished" | "cancelled") => {
    const { error } = await supabase.from("tournaments").update({ status }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success(t("clubAdmin.statusUpdated")); loadClubData(activeClub.id); }
  };


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-primary">Club Admin</h1>
      </div>

      {clubs.length === 0 ? (
        <Card className="p-6 text-center gradient-card border-primary/40">
          <Building2 className="w-10 h-10 mx-auto text-primary mb-2" />
          <p className="text-sm text-muted-foreground">You don't own any club yet. Contact a Super Admin to be assigned as a club owner.</p>
        </Card>
      ) : (
        <>
          <Select value={activeClub?.id} onValueChange={(id) => setActiveClub(clubs.find(c => c.id === id))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {clubs.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.status})</SelectItem>)}
            </SelectContent>
          </Select>

          {activeClub && (
            <Card className="p-4 gradient-card border-primary/40">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-display text-lg">{activeClub.name}</h2>
                <StatusBadge status={activeClub.status === "approved" ? "confirmed" : activeClub.status === "pending" ? "pending" : "rejected"} />
              </div>
              <p className="text-xs text-muted-foreground">{activeClub.address} · {activeClub.region}</p>
            </Card>
          )}

          {activeClub && (isClubAdmin || isClubOwner) && (
            <Card className="p-4 gradient-card border-primary/50 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> Tài chính CLB</h3>
                <p className="text-xs text-muted-foreground">Doanh thu (phí + rake), chi phí lương, lãi ròng, công nợ lương — chỉ xem.</p>
              </div>
              <Button asChild size="sm">
                <Link to="/club/admin/finance">
                  <Wallet className="w-4 h-4" /> Mở
                </Link>
              </Button>
            </Card>
          )}

          {activeClub && (isClubAdmin || isClubOwner) && FEATURES.insuranceProfiles && (
            <Card className="p-4 gradient-card border-primary/40 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> Bảo hiểm dealer</h3>
                <p className="text-xs text-muted-foreground">Khai báo dealer nào tham gia BHXH/BHYT/BHTN, vùng &amp; lương căn cứ — không đổi công thức lương.</p>
              </div>
              <Button asChild size="sm">
                <Link to="/club/admin/insurance">
                  <ShieldCheck className="w-4 h-4" /> Mở
                </Link>
              </Button>
            </Card>
          )}

          {activeClub && (
            <Card className="p-4 gradient-card border-primary/40 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base">Đồng bộ thành viên CLB</h3>
                <p className="text-xs text-muted-foreground">Upload CSV danh sách thành viên, in QR thẻ và tra cứu nhanh.</p>
              </div>
              <Button asChild size="sm">
                <Link to={`/cashier?tab=members&sub=sync`}>
                  <FileSpreadsheet className="w-4 h-4" /> Mở
                </Link>
              </Button>
            </Card>
          )}

          {activeClub && (
            <ClubBankAccountManager clubId={activeClub.id} />
          )}

          {activeClub && (
            <ClubBotConfig
              club={activeClub}
              onSaved={() => {
                loadClubs();
              }}
            />
          )}

          {activeClub && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-display text-primary">Dealer Tour (Ca làm việc)</h3>
                <NewDealerShiftDialog clubId={activeClub.id} onCreated={() => loadClubData(activeClub.id)} />
              </div>
              {dealerShifts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Chưa có tour nào.</p>
              ) : (
                <div className="space-y-2">
                  {dealerShifts.map((s) => (
                    <Card key={s.id} className="p-3 flex items-center justify-between border-primary/20">
                      <div>
                        <div className="font-semibold text-sm">{s.tour_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.start_time?.slice(0, 5)} - {s.end_time?.slice(0, 5)}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={async () => {
                          if (!confirm("Xoá tour này?")) return;
                          const { error } = await supabase.from("dealer_shifts").delete().eq("id", s.id);
                          if (error) toast.error(error.message);
                          else { toast.success("Đã xoá tour"); loadClubData(activeClub.id); }
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeClub && (
            <section>
              <h3 className="font-display text-primary mb-2">Livestream</h3>
              <StreamLinkManager clubId={activeClub.id} />
            </section>
          )}

          {/* Booking requests (chat-based) */}
          <section>
            <h3 className="font-display text-primary mb-2">{t("clubAdmin.bookingRequests")} <span className="text-xs text-muted-foreground">({bookings.filter(b => b.status !== "closed").length} {t("clubAdmin.active")})</span></h3>
            {bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("clubAdmin.noBookings")}</p>
            ) : bookings.map(b => (
              <Card key={b.id} className={`p-3 mb-2 ${b.status === "closed" ? "" : "border-primary/40"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{b.player?.display_name || "Player"}{b.player?.phone ? ` · ${b.player.phone}` : ""}</div>
                    <div className="text-xs text-muted-foreground truncate">{b.tournament?.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {b.status === "closed" ? t("clubAdmin.closed") : t("clubAdmin.open")}
                      {b.payment_confirmed && ` · ${t("clubAdmin.paid")} ✓`}
                    </div>
                  </div>
                  <Link to={`/chat/${b.tournament_id}?asReceptionist=${b.id}`}>
                    <Button size="sm" variant="outline" className="border-primary/40 text-primary hover:bg-primary/10">
                      <MessageCircle className="w-4 h-4 mr-1" />{t("clubAdmin.reply")}
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display text-primary">{t("clubAdmin.tournaments")}</h3>
              {activeClub && <NewTournamentDialog clubId={activeClub.id} onCreated={() => loadClubData(activeClub.id)} />}
            </div>
            {tours.length === 0 ? <p className="text-sm text-muted-foreground">{t("clubAdmin.noTournaments")}</p> : tours.map(t2 => (
              <Card key={t2.id} className="p-3 mb-2 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{t2.name}</div>
                    <div className="text-xs text-muted-foreground">{formatDateTime(t2.start_time)}</div>
                    <div className="mt-0.5"><FomoPrice tournament={t2} /></div>
                    <div className="text-[11px] text-muted-foreground">{t("clubAdmin.stack")}: {t2.starting_stack?.toLocaleString?.() ?? t2.starting_stack}{t2.location ? ` · 📍 ${t2.location}` : ""}</div>
                  </div>
                  <div className="flex gap-1">
                    <EditTournamentDialog tournament={t2} onSaved={() => loadClubData(activeClub.id)} />
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
                <LiveStateEditor tournament={t2} onSaved={() => loadClubData(activeClub.id)} />
              </Card>
            ))}
          </section>

          <section>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h3 className="font-display text-primary">{t("clubAdmin.confirmedRegs")}</h3>
              <PaymentExport bookings={bookings} tournaments={tours} regs={regs} />
            </div>
            {regs.filter(r => r.status === "confirmed").length === 0 ? <p className="text-sm text-muted-foreground">{t("clubAdmin.noPaidRegs")}</p> : regs.filter(r => r.status === "confirmed").map(r => (
              <Card key={r.id} className="p-3 mb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.profile?.display_name || "Player"}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.tournament?.name}</div>
                    {r.profile?.phone && <div className="text-xs text-primary">{r.profile.phone}</div>}
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                {r.status === "pending" && (
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" className="flex-1 bg-success text-success-foreground hover:bg-success/90" onClick={() => updateReg(r.id, "confirmed")}>
                      <Check className="w-4 h-4 mr-1" />{t("common.confirm")}
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => updateReg(r.id, "rejected")}>
                      <X className="w-4 h-4 mr-1" />{t("common.cancel")}
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </section>

          {/* Profile update logs */}
          {activeClub && (
            <section>
              <h3 className="font-display text-primary mb-2">Lịch sử cập nhật hồ sơ</h3>
              {profileLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Chưa có cập nhật nào.</p>
              ) : (
                <div className="space-y-2">
                  {profileLogs.map((log) => (
                    <ProfileUpdateRow key={log.id} log={log} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};

const NewTournamentDialog = ({ clubId, onCreated }: { clubId: string; onCreated: () => void }) => {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", start_time: "", buy_in: 1000000, rake_amount: 0, service_fee_amount: 0, starting_stack: 20000, location: "", description: "", game_type: "nlh", minutes_per_level: 20, late_reg_close_level: 6 });
  const submit = async () => {
    if (!f.name || !f.start_time) return toast.error("Please fill all required fields");
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
      <DialogTrigger asChild><Button size="sm" variant="outline" className="border-primary/50 text-primary"><Plus className="w-4 h-4" />New</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Tournament</DialogTitle></DialogHeader>
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
      <DialogContent>
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

const PRESETS = [
  { k: "today", l: "Today" },
  { k: "yesterday", l: "Yesterday" },
  { k: "7d", l: "Last 7 days" },
  { k: "30d", l: "Last 30 days" },
  { k: "month", l: "This month" },
  { k: "all", l: "All time" },
];

const presetRange = (k: string): [string, string] => {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const t = iso(today);
  if (k === "today") return [t, t];
  if (k === "yesterday") {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    return [iso(y), iso(y)];
  }
  if (k === "7d") {
    const s = new Date(today); s.setDate(s.getDate() - 6);
    return [iso(s), t];
  }
  if (k === "30d") {
    const s = new Date(today); s.setDate(s.getDate() - 29);
    return [iso(s), t];
  }
  if (k === "month") {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return [iso(s), t];
  }
  return ["2000-01-01", t];
};

const PaymentExport = ({ bookings, tournaments, regs }: { bookings: any[]; tournaments: any[]; regs: any[] }) => {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [preset, setPreset] = useState("today");

  const tourMap = Object.fromEntries(tournaments.map((t) => [t.id, t]));

  const applyPreset = (k: string) => {
    setPreset(k);
    const [f, t] = presetRange(k);
    setFrom(f); setTo(t);
  };

  const fromTs = new Date(from + "T00:00:00").getTime();
  const toTs = new Date(to + "T23:59:59").getTime();

  // Source 1: confirmed registrations within range
  const confirmedRegs = regs.filter((r) => {
    if (r.status !== "confirmed") return false;
    const ts = new Date(r.updated_at || r.created_at).getTime();
    return ts >= fromTs && ts <= toTs;
  });
  // Source 2: paid booking chats within range (covers cases where registration row missing)
  const paidBookings = bookings.filter((b) => {
    if (!b.payment_confirmed) return false;
    const ts = new Date(b.updated_at).getTime();
    return ts >= fromTs && ts <= toTs;
  });

  // Merge by player+tournament to dedupe
  const key = (uid: string, tid: string) => `${uid}::${tid}`;
  const map = new Map<string, any>();
  confirmedRegs.forEach((r) => {
    const t = tourMap[r.tournament_id] || r.tournament;
    map.set(key(r.user_id, r.tournament_id), {
      "Player": r.profile?.display_name ?? "",
      "Phone": r.profile?.phone ?? "",
      "Tournament": t?.name ?? "",
      "Buy-in (VND)": t?.buy_in ?? "",
      "Confirmed at": new Date(r.updated_at || r.created_at).toLocaleString(),
      "Source": "Registration",
    });
  });
  paidBookings.forEach((b) => {
    const k = key(b.player_id, b.tournament_id);
    if (map.has(k)) return;
    const t = tourMap[b.tournament_id] || b.tournament;
    map.set(k, {
      "Player": b.player?.display_name ?? "",
      "Phone": b.player?.phone ?? "",
      "Tournament": t?.name ?? "",
      "Buy-in (VND)": t?.buy_in ?? "",
      "Confirmed at": new Date(b.updated_at).toLocaleString(),
      "Source": "Chat (Paid)",
    });
  });
  const rows = Array.from(map.values());

  const exportXlsx = () => {
    if (rows.length === 0) return toast.error("No paid records in this date range");
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Paid");
    XLSX.writeFile(wb, `vinpoker-paid-${from}_to_${to}.xlsx`);
    toast.success(`Exported ${rows.length} record(s)`);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-primary/40 text-primary">
          <FileSpreadsheet className="w-4 h-4 mr-1" />Export Excel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Export Paid Registrations</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Quick range</Label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {PRESETS.map((p) => (
                <Button
                  key={p.k}
                  size="sm"
                  variant={preset === p.k ? "default" : "outline"}
                  className={preset === p.k ? "gradient-neon text-primary-foreground border-0 h-7 text-xs" : "h-7 text-xs border-primary/30"}
                  onClick={() => applyPreset(p.k)}
                >
                  {p.l}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>From</Label>
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} />
            </div>
          </div>
          <Card className="p-3 bg-muted/30 border-primary/20">
            <div className="text-xs text-muted-foreground">Preview</div>
            <div className="text-lg font-display text-primary">{rows.length} record(s)</div>
            <div className="text-[11px] text-muted-foreground">{from} → {to}</div>
          </Card>
          <Button onClick={exportXlsx} disabled={rows.length === 0} className="w-full gradient-neon text-primary-foreground border-0">
            <FileSpreadsheet className="w-4 h-4 mr-1" />Download .xlsx
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ProfileUpdateRow = ({ log }: { log: any }) => {
  const [expanded, setExpanded] = useState(false);
  const fields = log.changed_fields as string[];
  const oldVals = log.old_values as Record<string, any>;
  const newVals = log.new_values as Record<string, any>;

  const FIELD_LABELS: Record<string, string> = {
    bank_name: "Ngân hàng",
    bank_account_number: "Số tài khoản",
    bank_account_holder: "Chủ tài khoản",
    phone: "Số điện thoại",
    display_name: "Tên hiển thị",
    bio: "Giới thiệu",
    avatar_url: "Ảnh đại diện",
  };

  return (
    <Card className="p-3 border-primary/20">
      <button className="w-full text-left flex items-start justify-between gap-2" onClick={() => setExpanded(!expanded)}>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{formatDateTime(log.created_at)}</div>
          <div className="font-semibold text-sm truncate">{log.player?.display_name || "Người dùng"}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {fields.map((f: string) => (
              <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                {FIELD_LABELS[f] ?? f}
              </span>
            ))}
          </div>
        </div>
        <div className="text-muted-foreground shrink-0 mt-1">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1 border-t border-primary/10 pt-2">
          {fields.map((f: string) => {
            const label = FIELD_LABELS[f] ?? f;
            const oldVal = oldVals[f] ?? "(trống)";
            const newVal = newVals[f] ?? "(trống)";
            return (
              <div key={f} className="text-xs grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
                <span className="text-muted-foreground truncate">{label}:</span>
                <span className="text-destructive line-through truncate">{String(oldVal)}</span>
                <span className="text-success truncate">{String(newVal)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

const NewDealerShiftDialog = ({ clubId, onCreated }: { clubId: string; onCreated: () => void }) => {
  const [open, setOpen] = useState(false);
  const [tourName, setTourName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!tourName.trim() || !startTime || !endTime) return toast.error("Vui lòng điền đầy đủ thông tin");
    setSaving(true);
    const { error } = await supabase.from("dealer_shifts").insert({
      club_id: clubId,
      tour_name: tourName.trim(),
      start_time: startTime,
      end_time: endTime,
    });
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Đã tạo tour mới"); setOpen(false); setTourName(""); setStartTime(""); setEndTime(""); onCreated(); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="border-primary/50 text-primary"><Plus className="w-4 h-4" />Tạo tour</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Tạo tour mới</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Tên tour</Label>
            <Input value={tourName} onChange={e => setTourName(e.target.value)} placeholder="VD: Tour Sáng" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Giờ bắt đầu</Label>
              <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Giờ kết thúc</Label>
              <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Huỷ</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Tạo tour"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ClubAdmin;
