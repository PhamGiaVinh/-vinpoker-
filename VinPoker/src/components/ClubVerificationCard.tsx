import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

interface Props {
  userId: string;
}

type Club = { id: string; name: string };
type Req = {
  id: string;
  club_id: string;
  member_card_id: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
};

export function ClubVerificationCard({ userId }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [verifiedClub, setVerifiedClub] = useState<Club | null>(null);
  const [latestReq, setLatestReq] = useState<Req | null>(null);
  const [forceRetry, setForceRetry] = useState(false);
  const [selectedClubId, setSelectedClubId] = useState("");
  const [cardId, setCardId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: profile }, { data: req }, { data: clubsData }] = await Promise.all([
      supabase.from("profiles").select("verification_status, verified_by_club_id").eq("user_id", userId).maybeSingle(),
      supabase
        .from("membership_verification_requests")
        .select("id, club_id, member_card_id, status, rejection_reason, created_at")
        .eq("player_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("clubs").select("id, name").eq("status", "approved").order("name"),
    ]);
    setClubs((clubsData ?? []) as Club[]);
    setLatestReq((req as any) ?? null);
    if (profile?.verification_status === "verified" && profile.verified_by_club_id) {
      const c = (clubsData ?? []).find((x: any) => x.id === profile.verified_by_club_id);
      if (c) setVerifiedClub(c as Club);
      else {
        const { data: vc } = await supabase.from("clubs").select("id, name").eq("id", profile.verified_by_club_id).maybeSingle();
        setVerifiedClub((vc as Club) ?? null);
      }
    } else {
      setVerifiedClub(null);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!selectedClubId) return toast.error(t("clubVerification.selectClub"));
    const trimmed = cardId.trim();
    if (!trimmed) return toast.error(t("clubVerification.enterCardId"));
    if (trimmed.length > 50) return toast.error(t("clubVerification.cardTooLong"));
    setSubmitting(true);
    const { data: existing } = await supabase
      .from("membership_verification_requests")
      .select("id")
      .eq("player_user_id", userId)
      .eq("club_id", selectedClubId)
      .eq("status", "pending")
      .limit(1);
    if (existing && existing.length > 0) {
      setSubmitting(false);
      toast(t("clubVerification.alreadyPending"));
      await load();
      setForceRetry(false);
      return;
    }
    const { error } = await supabase.from("membership_verification_requests").insert({
      player_user_id: userId,
      club_id: selectedClubId,
      member_card_id: trimmed,
      status: "pending",
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success(t("clubVerification.submitted"));
    setCardId("");
    setSelectedClubId("");
    setForceRetry(false);
    await load();
  };

  if (loading) {
    return (
      <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> {t("clubVerification.loading")}
      </Card>
    );
  }

  // STATE C
  if (verifiedClub) {
    return (
      <Card className="p-4 space-y-2 border-blue-500/40">
        <h3 className="font-semibold text-gold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> {t("clubVerification.title")}
        </h3>
        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/40">
          {t("clubVerification.verifiedBy", { name: verifiedClub.name })}
        </Badge>
      </Card>
    );
  }

  const pending = latestReq?.status === "pending";
  const rejected = latestReq?.status === "rejected" && !forceRetry;
  const clubName = (id: string) => clubs.find((c) => c.id === id)?.name ?? "—";

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold text-gold flex items-center gap-2">
        <ShieldCheck className="w-4 h-4" /> {t("clubVerification.title")}
      </h3>

      {pending && latestReq && (
        <div className="space-y-2">
          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40">
            {t("clubVerification.pendingBadge")}
          </Badge>
          <div className="text-sm text-muted-foreground">
            {t("clubVerification.clubLabel")} <span className="text-foreground font-medium">{clubName(latestReq.club_id)}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            {t("clubVerification.cardLabel")} <span className="text-foreground font-mono">{latestReq.member_card_id}</span>
          </div>
        </div>
      )}

      {rejected && latestReq && (
        <div className="space-y-2">
          <Badge variant="destructive">{t("clubVerification.rejectedBadge")}</Badge>
          <div className="text-sm text-muted-foreground">
            {t("clubVerification.clubLabel")} <span className="text-foreground font-medium">{clubName(latestReq.club_id)}</span>
          </div>
          {latestReq.rejection_reason && (
            <div className="text-sm text-muted-foreground">
              {t("clubVerification.reasonLabel")} <span className="text-foreground">{latestReq.rejection_reason}</span>
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => setForceRetry(true)}>{t("clubVerification.retry")}</Button>
        </div>
      )}

      {!pending && !rejected && (
        <>
          <p className="text-sm text-muted-foreground">
            {t("clubVerification.intro")}
          </p>
          <div className="space-y-2">
            <Label>{t("clubVerification.clubField")}</Label>
            <Select value={selectedClubId} onValueChange={setSelectedClubId} disabled={submitting}>
              <SelectTrigger><SelectValue placeholder={t("clubVerification.selectClubPh")} /></SelectTrigger>
              <SelectContent>
                {clubs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("clubVerification.cardField")}</Label>
            <Input
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              placeholder={t("clubVerification.cardPh")}
              maxLength={50}
              disabled={submitting}
            />
          </div>
          <Button onClick={submit} disabled={submitting} className="w-full">
            {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("clubVerification.submitting")}</> : t("clubVerification.submit")}
          </Button>
        </>
      )}
    </Card>
  );
}
