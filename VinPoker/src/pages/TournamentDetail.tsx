import { useEffect, useState } from "react";
import { useNavigate, useParams, Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Coins, Layers, MapPin, Calendar, Users, Loader2, Radio } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { formatVND, formatStack, formatDateTime } from "@/lib/format";
import { FomoPrice } from "@/components/FomoPrice";
import { getTournamentPrice } from "@/lib/tournament";
import { LiveStateBanner } from "@/components/LiveStateBanner";
import { TournamentRegisterModal } from "@/components/TournamentRegisterModal";
import { LivestreamPlayer } from "@/components/LivestreamPlayer";
import { FEATURES } from "@/lib/featureFlags";


const TournamentDetail = () => {
  const { t: tr } = useTranslation();
  const { id } = useParams();
  const [sp] = useSearchParams();
  const livestreamMode = sp.get("from") === "livestream";
  const nav = useNavigate();
  const { user } = useAuth();
  const [t, setT] = useState<any>(null);
  const [count, setCount] = useState(0);
  const [myReg, setMyReg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [myReg2, setMyReg2] = useState<any>(null);
  const [myReentry, setMyReentry] = useState<any>(null);   // pending re-entry reg (flag-gated)
  const [myEliminated, setMyEliminated] = useState(false); // latest entry busted + no active seat
  const [registerMode, setRegisterMode] = useState<"register" | "reentry">("register");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("tournaments")
      .select("*, club:clubs(id,name,region,address)")
      .eq("id", id!).maybeSingle();
    setT(data);
    const { count: c } = await supabase.from("stack_registrations")
      .select("*", { count: "exact", head: true })
      .eq("tournament_id", id!).in("status", ["pending", "confirmed"]);
    setCount(c ?? 0);
    if (user) {
      const { data: r } = await supabase.from("stack_registrations")
        .select("*").eq("tournament_id", id!).eq("user_id", user.id).maybeSingle();
      setMyReg(r);
      if (FEATURES.dynamicReentry) {
        // Re-entry ON: a player can hold a confirmed INITIAL reg AND a pending re-entry → scope each
        // (and only reference source_entry_id here, where STAGE B's column is guaranteed applied).
        const { data: r2 } = await supabase.from("tournament_registrations")
          .select("id, status, reference_code, total_pay")
          .eq("tournament_id", id!).eq("player_id", user.id)
          .is("source_entry_id", null)
          .in("status", ["pending", "confirmed"]).maybeSingle();
        setMyReg2(r2);
        const { data: rr } = await supabase.from("tournament_registrations")
          .select("id, status").eq("tournament_id", id!).eq("player_id", user.id)
          .not("source_entry_id", "is", null).eq("status", "pending")
          .order("committed_at", { ascending: false }).limit(1).maybeSingle();
        setMyReentry(rr);
        const { data: en } = await supabase.from("tournament_entries")
          .select("status").eq("tournament_id", id!).eq("player_id", user.id)
          .order("entry_no", { ascending: false }).limit(1).maybeSingle();
        const { data: seat } = await supabase.from("tournament_seats")
          .select("id").eq("tournament_id", id!).eq("player_id", user.id).eq("is_active", true).limit(1).maybeSingle();
        setMyEliminated(en?.status === "busted" && !seat);
      } else {
        const { data: r2 } = await supabase.from("tournament_registrations")
          .select("id, status, reference_code, total_pay")
          .eq("tournament_id", id!).eq("player_id", user.id)
          .in("status", ["pending", "confirmed"])
          .maybeSingle();
        setMyReg2(r2);
      }
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [id, user?.id]);

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`tournament-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${id}` }, (payload) => {
        setT((prev: any) => prev ? { ...prev, ...payload.new } : prev);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "stack_registrations", filter: `tournament_id=eq.${id}` }, () => {
        supabase.from("stack_registrations").select("*", { count: "exact", head: true })
          .eq("tournament_id", id).in("status", ["pending", "confirmed"])
          .then(({ count: c }) => setCount(c ?? 0));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  const openChat = () => {
    if (!user) { nav("/auth"); return; }
    nav(`/chat/${id}`);
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!t) return <p className="text-center py-20 text-muted-foreground">{tr("tournamentDetail.notFound")}</p>;

  return (
    <div className={livestreamMode ? "space-y-4 pb-32 md:pb-4" : "space-y-4 pb-40 md:pb-4"}>
      <BackButton label={tr("tournamentDetail.back")} />

      <Card className="gradient-card border-gold p-5 shadow-gold">
        <div className="text-xs text-gold/80 uppercase tracking-widest">{t.club?.name}</div>
        <h1 className="font-display text-2xl mt-1">{t.name}</h1>
        <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1.5">
          <Calendar className="w-4 h-4" /> {formatDateTime(t.start_time)}
        </p>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <Info icon={Coins} label={tr("tournamentDetail.buyIn")} value={<FomoPrice tournament={t} />} />
          <Info icon={Layers} label={tr("tournamentDetail.startingStack")} value={formatStack(t.starting_stack)} />
          <Info icon={MapPin} label={tr("tournamentDetail.location")} value={t.location || t.club?.address || "—"} />
          <Info icon={Users} label={tr("tournamentDetail.registered")} value={tr("tournamentDetail.players", { n: Math.max(t.current_players ?? 0, count) })} />
        </div>
      </Card>

      {["live", "break", "final_table", "registering"].includes(t.status) && (
        <div className="rounded-xl border border-success/30 bg-gradient-to-r from-success/40 to-success/10 p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-success/15 text-success rounded-md text-xs font-bold border border-success/30 animate-pulse">
                <Radio className="w-3.5 h-3.5" /> LIVE
              </div>
              <div>
                <div className="text-sm font-bold text-success">
                  {t.status === "registering" ? tr("tournamentDetailPage.statusRegistering") : t.status === "break" ? tr("tournamentDetailPage.statusBreak") : t.status === "final_table" ? tr("tournamentDetailPage.statusFinalTable") : tr("tournamentDetailPage.statusPlaying")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t.players_remaining != null && tr("tournamentDetailPage.playersRemaining", { n: t.players_remaining })}
                  {t.current_level != null && ` · Lv ${t.current_level}`}
                  {t.current_blinds && ` · ${t.current_blinds}`}
                </div>
              </div>
            </div>
            <Link to={`/live/${t.id}`}>
              <Button size="sm" className="bg-success/15 text-success border border-success/40 hover:bg-success/25 font-bold tracking-wider rounded-full px-4 h-9" variant="ghost">
                <Radio className="w-4 h-4 mr-1.5" /> {tr("tournamentDetailPage.watchLive")}
              </Button>
            </Link>
          </div>
        </div>
      )}

      {getTournamentPrice(t).hasDiscount && (
        <Card className="p-4 border-success/30 bg-success/5">
          <p className="text-sm text-success font-semibold flex items-center gap-2">
            {tr("tournamentDetailPage.freeServicePromo", { n: getTournamentPrice(t).remainingSlots })}
          </p>
        </Card>
      )}

      <LivestreamPlayer tournamentId={t.id} />

      {t.description && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2 text-gold">{tr("tournamentDetail.description")}</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-line">{t.description}</p>
        </Card>
      )}

      <Card className="p-4">
        <Link to={`/club/${t.club?.id}`} className="text-sm hover:text-primary">
          {tr("tournamentDetail.viewClub")} <span className="text-gold">{t.club?.name}</span> →
        </Link>
      </Card>

      {!livestreamMode && (
        <div className="fixed inset-x-0 z-30 px-4 pb-3 pt-2 bg-gradient-to-t from-background via-background/95 to-transparent bottom-[calc(88px+env(safe-area-inset-bottom))] md:bottom-4">
          <div className="mx-auto max-w-3xl space-y-2">
            {FEATURES.dynamicReentry && (myReentry || myEliminated)
              && (t.current_level == null || Number(t.current_level) <= Number(t.late_reg_close_level ?? 6)) ? (
              <>
                {t.current_level != null && Number(t.current_level) === Number(t.late_reg_close_level ?? 6) && (
                  <div className="text-[11px] text-warning text-center">Cửa đăng ký sắp đóng — thanh toán ngay.</div>
                )}
                <Button onClick={() => { setRegisterMode("reentry"); setRegisterOpen(true); }} size="lg" className="w-full gradient-gold text-primary-foreground border-0">
                  {myReentry ? "⏳ Tiếp tục thanh toán (mua lại)" : "Mua lại"}
                </Button>
              </>
            ) : myReg2?.status === "confirmed" ? (
              <Button disabled size="lg" className="w-full" variant="secondary">
                ✅ {tr("tournamentDetailPage.registeredCheckin")}
              </Button>
            ) : myReg2?.status === "pending" ? (
              <Button onClick={() => { setRegisterMode("register"); setRegisterOpen(true); }} size="lg" className="w-full gradient-gold text-primary-foreground border-0">
                ⏳ {tr("tournamentDetailPage.continuePayment")}
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={openChat} variant="outline" size="lg">
                  💬 {tr("tournamentDetailPage.chatWithClub")}
                </Button>
                <Button onClick={() => { if (user) { setRegisterMode("register"); setRegisterOpen(true); } else { nav("/auth"); } }} disabled={submitting} size="lg" className="gradient-gold text-primary-foreground border-0 shadow-gold">
                  {tr("tournamentDetailPage.registerTournament")}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <TournamentRegisterModal
        tournamentId={t.id}
        tournamentName={t.name}
        open={registerOpen}
        mode={registerMode}
        onClose={() => { setRegisterOpen(false); setRegisterMode("register"); load(); }}
        onCompleted={() => load()}
      />
    </div>
  );
};

const Info = ({ icon: Icon, label, value }: any) => (
  <div className="rounded-lg bg-muted/40 px-3 py-2 border border-border/50">
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase">
      <Icon className="w-3 h-3" />{label}
    </div>
    <div className="font-medium text-sm mt-0.5">{value}</div>
  </div>
);

export default TournamentDetail;
