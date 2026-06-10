import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatVND, formatStack } from "@/lib/format";
import { computeAskingPrice, computeStakingPayouts } from "@/lib/stakingMath";
import { AlertCircle, Sparkles, Info, Lock } from "lucide-react";
import { getLateRegCloseTime } from "@/lib/tournamentLive";
import { FomoPrice } from "@/components/FomoPrice";
import { getTournamentPrice } from "@/lib/tournament";

interface TournamentOpt {
  id: string;
  name: string;
  start_time: string;
  buy_in: number;
  rake_amount?: number;
  free_rake_enabled?: boolean;
  free_rake_slots?: number;
  free_rake_used?: number;
  club_id: string | null;
  minutes_per_level: number | null;
  late_reg_close_level: number | null;
}

// Convert a Date to a value compatible with <input type="datetime-local"> in LOCAL time.
function toLocalInputValue(d: Date): string {
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

interface ClubOpt {
  id: string;
  name: string;
}

const SIM_PRIZES = [100_000_000];
const MAX_ACTIVE_DEALS = 3;
const MAX_PCT_PER_TOURNAMENT = 50;

const StakingNew = () => {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();

  const [tournaments, setTournaments] = useState<TournamentOpt[]>([]);
  const [tournamentId, setTournamentId] = useState<string>("");
  const [customName, setCustomName] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [customVenue, setCustomVenue] = useState("");
  const [buyIn, setBuyIn] = useState<number>(0);
  const [percentage, setPercentage] = useState<number>(20);
  const [markup, setMarkup] = useState<number>(1.2);
  const [description, setDescription] = useState("");
  const [registrationDeadline, setRegistrationDeadline] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Club selection (required to identify host club)
  const [clubs, setClubs] = useState<ClubOpt[]>([]);
  const [clubId, setClubId] = useState<string>("");

  // KYC gate
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setVerifyLoading(true);
      const { data } = await supabase
        .from("profiles")
        .select("verification_status")
        .eq("user_id", user.id)
        .maybeSingle();
      setVerificationStatus((data as any)?.verification_status ?? "unverified");
      setVerifyLoading(false);
    })();
  }, [user]);

  const isVerified = verificationStatus === "verified";

  // Validation guard data
  const [activeCount, setActiveCount] = useState<number>(0);
  const [pctSoldForTournament, setPctSoldForTournament] = useState<number>(0);
  const [existingDealForTournament, setExistingDealForTournament] = useState<{ id: string; filled_percent: number; percentage_sold: number } | null>(null);

  const isCustom = tournamentId === "__custom__";
  const selectedTournament = useMemo(
    () => tournaments.find((t) => t.id === tournamentId) ?? null,
    [tournaments, tournamentId]
  );

  // Auth gate
  useEffect(() => {
    if (!authLoading && !user) nav("/auth");
  }, [authLoading, user, nav]);

  // Load upcoming tournaments + approved clubs
  useEffect(() => {
    (async () => {
      const [{ data: tData }, { data: cData }] = await Promise.all([
        supabase
          .from("tournaments")
          .select("id, name, start_time, buy_in, rake_amount, free_rake_enabled, free_rake_slots, free_rake_used, club_id, minutes_per_level, late_reg_close_level")
          .gt("start_time", new Date().toISOString())
          .order("start_time", { ascending: true })
          .limit(80),
        supabase
          .from("clubs")
          .select("id, name")
          .eq("status", "approved")
          .order("name", { ascending: true }),
      ]);
      setTournaments((tData ?? []) as TournamentOpt[]);
      setClubs((cData ?? []) as ClubOpt[]);
    })();
  }, []);

  // Auto-fill + lock club_id when tournament is selected
  useEffect(() => {
    if (selectedTournament?.club_id) {
      setClubId(selectedTournament.club_id);
    } else if (isCustom) {
      // Allow user to choose freely for custom event
    }
  }, [selectedTournament, isCustom]);

  // Auto-compute registration deadline from tournament TD config (read-only).
  // For custom event: clear so player can pick manually.
  useEffect(() => {
    if (selectedTournament) {
      const close = getLateRegCloseTime({
        start_time: selectedTournament.start_time,
        minutes_per_level: selectedTournament.minutes_per_level,
        late_reg_close_level: selectedTournament.late_reg_close_level,
      });
      setRegistrationDeadline(toLocalInputValue(close));
    } else if (isCustom) {
      setRegistrationDeadline("");
    }
  }, [selectedTournament, isCustom]);

  // Load player's active deals count
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { count } = await supabase
        .from("staking_deals")
        .select("id", { count: "exact", head: true })
        .eq("player_id", user.id)
        .in("status", ["listing", "committed", "funded", "locked", "disputed"]);
      setActiveCount(count ?? 0);
    })();
  }, [user]);

  // When tournament selected → autofill buyIn + check existing % sold
  useEffect(() => {
    if (!user) return;
    if (isCustom || !tournamentId) {
      setPctSoldForTournament(0);
      setExistingDealForTournament(null);
      return;
    }
    if (selectedTournament) setBuyIn(selectedTournament.buy_in);
    (async () => {
      const { data } = await supabase
        .from("staking_deals")
        .select("id, percentage_sold, filled_percent, status")
        .eq("player_id", user.id)
        .eq("tournament_id", tournamentId)
        .not("status", "in", "(completed,cancelled)");
      const total = (data ?? []).reduce((s, d: any) => s + (d.percentage_sold ?? 0), 0);
      setPctSoldForTournament(total);
      const first = (data ?? [])[0] as any;
      setExistingDealForTournament(first ? { id: first.id, filled_percent: first.filled_percent ?? 0, percentage_sold: first.percentage_sold ?? 0 } : null);
    })();
  }, [tournamentId, isCustom, selectedTournament, user]);

  const askingPrice = useMemo(
    () => (buyIn > 0 ? computeAskingPrice(buyIn, percentage, markup) : 0),
    [buyIn, percentage, markup]
  );

  const remainingPctForTournament = Math.max(0, MAX_PCT_PER_TOURNAMENT - pctSoldForTournament);

  const blockers: string[] = [];
  if (activeCount >= MAX_ACTIVE_DEALS) {
    blockers.push(t("stakingNew.blockerActive", { n: activeCount, max: MAX_ACTIVE_DEALS }));
  }
  if (!isCustom && tournamentId && existingDealForTournament) {
    blockers.push("Bạn đã có 1 phiếu hợp tác đang mở cho giải này. Vui lòng đóng phiếu cũ trước khi tạo phiếu mới.");
  }
  if (!isCustom && tournamentId && percentage > remainingPctForTournament) {
    blockers.push(t("stakingNew.blockerSold", { sold: pctSoldForTournament, max: MAX_PCT_PER_TOURNAMENT, rem: remainingPctForTournament }));
  }
  if (!tournamentId) blockers.push(t("stakingNew.blockerNoTournament"));
  if (isCustom && (!customName.trim() || !customDate)) {
    blockers.push(t("stakingNew.blockerCustom"));
  }
  if (buyIn <= 0) blockers.push(t("stakingNew.blockerBuyIn"));
  if (percentage < 1 || percentage > MAX_PCT_PER_TOURNAMENT) {
    blockers.push(t("stakingNew.blockerPct", { max: MAX_PCT_PER_TOURNAMENT }));
  }
  if (markup < 1.0 || markup > 1.5) blockers.push(t("stakingNew.blockerMarkup"));
  if (!clubId) blockers.push(t("stakingNew.blockerClub"));

  // Validate registration deadline
  const tournamentStartIso = isCustom ? customDate : selectedTournament?.start_time;
  const deadlineDate = registrationDeadline ? new Date(registrationDeadline) : null;
  if (!registrationDeadline) {
    blockers.push(t("stakingNew.blockerDeadline"));
  } else if (deadlineDate) {
    if (deadlineDate.getTime() <= Date.now()) {
      blockers.push(t("stakingNew.blockerDeadlinePast"));
    } else if (tournamentStartIso) {
      const maxDeadline = new Date(tournamentStartIso).getTime() + 3 * 60 * 60 * 1000;
      if (deadlineDate.getTime() > maxDeadline) {
        blockers.push(t("stakingNew.blockerDeadlineMax"));
      }
    }
  }

  const canSubmit = blockers.length === 0 && !submitting;

  const handleSubmit = async () => {
    if (!user) return;
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload: any = {
        player_id: user.id,
        buy_in_amount_vnd: buyIn,
        percentage_sold: percentage,
        markup,
        description: description.trim() || null,
        status: "listing",
        admin_review_status: "pending",
        registration_deadline: new Date(registrationDeadline).toISOString(),
        club_id: clubId,
      };
      if (isCustom) {
        payload.tournament_id = null;
        payload.custom_event_name = customName.trim();
        payload.custom_event_date = new Date(customDate).toISOString();
        payload.custom_event_venue = customVenue.trim() || null;
      } else {
        payload.tournament_id = tournamentId;
      }
      const { error } = await supabase.from("staking_deals").insert(payload);
      if (error) {
        const msg = String(error.message || "");
        if (error.code === "42501" || /row-level security|verification_status/i.test(msg)) {
          throw new Error("Bạn cần xác minh danh tính qua CLB trước khi tạo deal gọi vốn.");
        }
        if (error.code === "23505" || /idx_one_active_deal_per_tournament/i.test(msg)) {
          throw new Error("Bạn đã có 1 phiếu hợp tác đang mở cho giải này. Vui lòng đóng phiếu cũ trước khi tạo phiếu mới.");
        }
        throw error;
      }
      toast.success(t("stakingNew.successToast"));
      nav("/staking/my-deals");
    } catch (e: any) {
      toast.error(e.message ?? t("stakingNew.createFail"));
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || verifyLoading) return <div className="staking-scope text-muted-foreground">{t("stakingNew.loading")}</div>;

  if (!isVerified) {
    return (
      <div className="staking-scope max-w-2xl mx-auto py-12">
        <div className="rounded-lg border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-orange-500/5 p-8 space-y-4 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Lock className="w-6 h-6 text-amber-500" />
            <h1 className="text-2xl font-display font-bold text-foreground">Cần xác minh danh tính</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            🔒 Bạn cần xác minh danh tính qua CLB để tạo deal gọi vốn. Đây là bước bắt buộc để bảo vệ cả Player và Backer.
          </p>
          <p className="text-xs text-muted-foreground">
            Trạng thái hiện tại: <span className="font-medium text-foreground">{verificationStatus === "pending" ? "Đang chờ CLB duyệt" : "Chưa xác minh"}</span>
          </p>
          <Button onClick={() => nav("/account?tab=verification")} className="w-full sm:w-auto">
            Xác minh ngay
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="staking-scope space-y-8 max-w-5xl mx-auto">
      <header className="flex items-center gap-3">
        <Sparkles className="w-6 h-6 text-primary" />
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground">{t("stakingNew.title")}</h1>
      </header>

      <Alert className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
        <Info className="h-4 w-4 text-primary flex-shrink-0" />
        <AlertDescription className="text-sm text-muted-foreground">
          {t("stakingNew.infoBanner")}
        </AlertDescription>
      </Alert>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* FORM */}
        <div className="space-y-6 p-6 rounded-xl border border-border/40 bg-gradient-to-br from-card/60 to-card/40 backdrop-blur-sm">
          <div className="space-y-2">
            <Label>{t("stakingNew.tournamentLbl")}</Label>
            <Select value={tournamentId} onValueChange={setTournamentId}>
              <SelectTrigger><SelectValue placeholder={t("stakingNew.tournamentPh")} /></SelectTrigger>
              <SelectContent>
                {tournaments.map((tt) => (
                  <SelectItem key={tt.id} value={tt.id}>
                    {tt.name} · <FomoPrice tournament={tt} compact />
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">{t("stakingNew.customOption")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!isCustom && existingDealForTournament && (
            <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <AlertDescription className="text-sm text-destructive/90">
                ⚠️ Bạn đã có 1 phiếu hợp tác đang mở cho giải này
                ({existingDealForTournament.filled_percent}/{existingDealForTournament.percentage_sold}% đã được hỗ trợ).
                <Button
                  variant="link"
                  size="sm"
                  className="px-0.5 h-auto text-destructive hover:text-destructive/80"
                  onClick={() => nav("/staking/my-deals")}
                >
                  Xem phiếu cũ →
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {isCustom && (
            <div className="space-y-3 p-4 rounded-lg border border-dashed border-border/40 bg-muted/20">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("stakingNew.eventName")}</Label>
                <Input value={customName} maxLength={120} onChange={(e) => setCustomName(e.target.value)} placeholder={t("stakingNew.eventNamePh")} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t("stakingNew.date")}</Label>
                  <Input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">{t("stakingNew.venue")}</Label>
                  <Input value={customVenue} maxLength={120} onChange={(e) => setCustomVenue(e.target.value)} placeholder={t("stakingNew.venuePh")} />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>
              {t("stakingNew.clubLbl")} <span className="text-[11px] text-muted-foreground font-normal">{t("stakingNew.clubHint")}</span>
            </Label>
            <Select
              value={clubId}
              onValueChange={setClubId}
              disabled={!isCustom && !!selectedTournament?.club_id}
            >
              <SelectTrigger><SelectValue placeholder={t("stakingNew.clubPh")} /></SelectTrigger>
              <SelectContent>
                {clubs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isCustom && selectedTournament?.club_id && (
              <p className="text-[11px] text-muted-foreground">{t("stakingNew.clubLocked")}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label>{t("stakingNew.buyInLbl")}</Label>
            <Input
              type="number"
              min={0}
              value={buyIn || ""}
              onChange={(e) => setBuyIn(Number(e.target.value || 0))}
              disabled={!isCustom && !!selectedTournament}
            />
            {!isCustom && selectedTournament && (
              <p className="text-[11px] text-muted-foreground">{t("stakingNew.buyInAuto")}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("stakingNew.sellPctLbl", { n: percentage })}</Label>
              {!isCustom && tournamentId && (
                <span className="text-[11px] text-muted-foreground">
                  {t("stakingNew.remainingMax")} <b className="text-foreground">{remainingPctForTournament}%</b>
                </span>
              )}
            </div>
            <Slider
              value={[percentage]}
              min={1}
              max={MAX_PCT_PER_TOURNAMENT}
              step={1}
              onValueChange={(v) => setPercentage(v[0])}
            />
          </div>

          <div className="space-y-1">
            <Label>{t("stakingNew.markupLbl", { n: markup.toFixed(2) })}</Label>
            <Slider
              value={[markup]}
              min={1.0}
              max={1.5}
              step={0.05}
              onValueChange={(v) => setMarkup(Number(v[0].toFixed(2)))}
            />
          </div>

          <div className="space-y-1">
            <Label className="flex items-center gap-1.5">
              {t("stakingNew.regCloseLbl")}
              {selectedTournament && <Lock className="w-3 h-3 text-muted-foreground" />}
            </Label>
            <Input
              type="datetime-local"
              value={registrationDeadline}
              onChange={(e) => setRegistrationDeadline(e.target.value)}
              disabled={!!selectedTournament}
            />
            {selectedTournament ? (
              <p className="text-[11px] text-muted-foreground">
                <Trans
                  i18nKey="stakingNew.regCloseAuto"
                  values={{ lvl: selectedTournament.late_reg_close_level ?? 6, min: selectedTournament.minutes_per_level ?? 20 }}
                  components={{ b: <b className="text-foreground" /> }}
                />
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {t("stakingNew.regCloseHint")}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label>{t("stakingNew.descLbl")}</Label>
            <Textarea
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("stakingNew.descPh")}
              rows={3}
            />
            <p className="text-[11px] text-muted-foreground text-right">{description.length}/500</p>
          </div>

          {blockers.length > 0 && (
            <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <AlertDescription>
                <ul className="list-disc pl-4 space-y-1 text-sm text-destructive/90">
                  {blockers.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Button
            size="lg"
            className="w-full gradient-neon text-primary-foreground font-bold tracking-wide shadow-neon"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? t("stakingNew.submitting") : t("stakingNew.submit")}
          </Button>
        </div>

        {/* SIMULATION PREVIEW */}
        <SimulationPreview
          buyIn={buyIn}
          percentage={percentage}
          markup={markup}
          askingPrice={askingPrice}
          selectedTournament={selectedTournament}
        />
      </div>
    </div>
  );
};

const SimulationPreview = ({
  buyIn, percentage, markup, askingPrice, selectedTournament,
}: { buyIn: number; percentage: number; markup: number; askingPrice: number; selectedTournament?: TournamentOpt | null }) => {
  const { t } = useTranslation();
  const fp = selectedTournament ? getTournamentPrice(selectedTournament) : null;
  return (
    <aside className="space-y-4 p-6 rounded-xl border border-primary/20 bg-gradient-to-br from-card/60 to-card/40 backdrop-blur-sm sticky top-20 h-fit">
      {fp?.hasDiscount && (
        <div className="rounded-lg border border-success/30 bg-gradient-to-r from-success/10 to-emerald-500/5 p-3 text-xs text-success font-semibold">
          🎉 Giải này đang có ưu đãi miễn phí DV CLB cho {fp.remainingSlots} suất đầu tiên. Còn {fp.remainingSlots} suất.
        </div>
      )}

      <div className="text-[11px] uppercase tracking-[0.2em] text-primary font-bold">{t("stakingNew.previewInfo")}</div>
      <div className="space-y-1.5 text-sm">
        <Row k="Lệ phí tập huấn" v={formatVND(buyIn)} />
        <Row k={t("stakingNew.previewSelling")} v={`${percentage}%`} />
        <Row k="Hệ số hỗ trợ" v={`${markup.toFixed(2)}x`} />
        <div className="border-t border-border pt-2 mt-2 flex items-center justify-between">
          <span className="text-muted-foreground">{t("stakingNew.previewBackerPays")}</span>
          <span className="text-lg font-bold text-primary">{formatVND(askingPrice)}</span>
        </div>
        <p className="text-[11px] text-muted-foreground italic">
          {t("stakingNew.previewFormula")}
        </p>
      </div>

      <div className="pt-3 border-t border-border space-y-2">
        <div className="text-[11px] uppercase tracking-[0.2em] text-primary font-bold">{t("stakingNew.exampleTitle")}</div>
        <p className="text-[11px] text-muted-foreground">
          {t("stakingNew.exampleHint")}
        </p>

        {SIM_PRIZES.map((prize) => {
          const p = computeStakingPayouts(prize, percentage, markup);
          return (
            <div key={prize} className="rounded-lg border border-border/40 p-3 bg-muted/20 text-xs space-y-2">
              <div className="font-semibold text-foreground text-sm">{t("stakingNew.ifPrize", { prize: formatStack(prize) + " điểm" })}</div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">{t("stakingNew.backer")}</div>
                   <div className="font-bold text-success text-sm">{formatStack(p.backer)}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">{t("stakingNew.youGet")}</div>
                  <div className="font-bold text-primary text-sm">{formatStack(p.player)}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">{t("stakingNew.fee2")}</div>
                  <div className="font-bold text-muted-foreground text-sm">{formatStack(p.fee)}</div>
                </div>
              </div>
            </div>
          );
        })}

        <div className="rounded-lg border border-destructive/30 p-3 bg-destructive/5 text-xs">
          <div className="font-semibold text-destructive text-sm">{t("stakingNew.ifBust")}</div>
          <div className="text-[11px] mt-2 text-destructive/80">
            <Trans
              i18nKey="stakingNew.bustText"
              values={{ price: formatStack(askingPrice) + " điểm" }}
              components={{ b: <b /> }}
            />
          </div>
        </div>
      </div>

      <div className="pt-2 text-[11px] text-warning leading-relaxed border-t border-border">
        {t("stakingNew.warnSimulation")}
      </div>
    </aside>
  );
};

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-muted-foreground">{k}</span>
    <span className="font-semibold">{v}</span>
  </div>
);

export default StakingNew;
