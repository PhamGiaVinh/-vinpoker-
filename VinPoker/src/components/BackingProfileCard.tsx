import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Check, X, Clock, AlertTriangle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { UpcomingEventsManager } from "./UpcomingEventsManager";
import { ResultsManager } from "./ResultsManager";

export const BackingProfileCard = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [interests, setInterests] = useState<any[]>([]);
  const [interestNames, setInterestNames] = useState<Map<string, any>>(new Map());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase.from("player_stats").select("*").eq("player_id", user.id).maybeSingle();
      setStats(
        data ?? {
          player_id: user.id,
          tournaments_played: 0,
          tournaments_cashed: 0,
          itm_rate: 0,
          roi_percentage: 0,
          total_profit_loss: 0,
          biggest_cash_amount: 0,
          current_streak: 0,
          avg_finish: 0,
          looking_for_backing: false,
          backing_description: "",
          backing_percentage_available: 20,
          verified: false,
          last_20_results: [],
        }
      );
      const { data: ints } = await supabase
        .from("backing_interests")
        .select("*")
        .eq("player_id", user.id)
        .order("created_at", { ascending: false });
      setInterests(ints ?? []);
      const ids = [...new Set((ints ?? []).map((i: any) => i.interested_user_id))];
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("user_id,display_name,phone").in("user_id", ids);
        setInterestNames(new Map((profs ?? []).map((p: any) => [p.user_id, p])));
      }
    };
    load();
    const ch = supabase
      .channel("acct-backing")
      .on("postgres_changes", { event: "*", schema: "public", table: "backing_interests", filter: `player_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  const save = async () => {
    if (!user || !stats) return;
    setSaving(true);
    const payload = {
      player_id: user.id,
      tournaments_played: stats.tournaments_played,
      tournaments_cashed: stats.tournaments_cashed,
      itm_rate: stats.itm_rate,
      roi_percentage: stats.roi_percentage,
      looking_for_backing: stats.looking_for_backing,
      backing_description: stats.backing_description?.trim() || null,
      backing_percentage_available: stats.backing_percentage_available,
    };
    const { error } = await supabase.from("player_stats").upsert(payload, { onConflict: "player_id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success(t("backingProfile.saved"));
  };

  const updateStatus = async (id: string, status: "contacted" | "declined") => {
    const { error } = await supabase.from("backing_interests").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success(status === "contacted" ? t("backingProfile.accepted") : t("backingProfile.declined"));
  };

  if (!stats) return null;

  return (
    <div className="space-y-3">
    <Card className="p-4 space-y-4 border-primary/30">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-primary">{t("backingProfile.title")}</h3>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{t("backingProfile.lookingForBacker")}</div>
          <div className="text-xs text-muted-foreground">{t("backingProfile.subtitle")}</div>
        </div>
        <Switch
          checked={stats.looking_for_backing}
          onCheckedChange={(v) => setStats({ ...stats, looking_for_backing: v })}
        />
      </div>

      {stats.looking_for_backing && stats.backing_status === "pending" && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-2 flex items-center gap-2">
          <Clock className="w-4 h-4 text-yellow-500 shrink-0" />
          <span className="text-xs text-yellow-500">{t("backingProfile.pending")}</span>
        </div>
      )}
      {stats.looking_for_backing && stats.backing_status === "approved" && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-2 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
          <span className="text-xs text-green-500">{t("backingProfile.approved")}</span>
        </div>
      )}
      {stats.looking_for_backing && stats.backing_status === "rejected" && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 space-y-1">
          <div className="flex items-center gap-2">
            <X className="w-4 h-4 text-red-500 shrink-0" />
            <span className="text-xs font-semibold text-red-500">{t("backingProfile.rejected")}</span>
          </div>
          {stats.backing_review_note && (
            <p className="text-xs text-red-400 italic pl-6">"{stats.backing_review_note}"</p>
          )}
          <p className="text-xs text-muted-foreground pl-6">{t("backingProfile.rejectedHint")}</p>
        </div>
      )}

      {stats.looking_for_backing && (
        <>
          <div>
            <label className="text-xs text-muted-foreground">{t("backingProfile.dealDescription")}</label>
            <Textarea
              value={stats.backing_description ?? ""}
              onChange={(e) => setStats({ ...stats, backing_description: e.target.value })}
              placeholder={t("backingProfile.dealPlaceholder")}
              maxLength={500}
              rows={3}
            />
          </div>
        </>
      )}

      {stats.looking_for_backing && stats.backing_status === "approved" && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
          <span className="text-xs text-yellow-500">{t("backingProfile.reapproveWarn")}</span>
        </div>
      )}

      <Button onClick={save} disabled={saving} className="w-full" size="sm">
        {saving ? t("backingProfile.saving") : t("backingProfile.saveProfile")}
      </Button>

      {interests.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border/40">
          <div className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
            {t("backingProfile.interestedUsers", { n: interests.length })}
          </div>
          {interests.map((i) => {
            const p = interestNames.get(i.interested_user_id);
            return (
              <div key={i.id} className="rounded-lg border border-border/40 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{p?.display_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{t("backingProfile.interestedIn", { n: i.percentage_interested })}</div>
                  </div>
                  <Badge
                    className={
                      i.status === "pending"
                        ? "bg-yellow-500/20 text-yellow-500 border-yellow-500/40"
                        : i.status === "contacted"
                        ? "bg-green-500/20 text-green-500 border-green-500/40"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {i.status === "pending" ? t("backingProfile.statusPending") : i.status === "contacted" ? t("backingProfile.statusContacted") : t("backingProfile.statusDeclined")}
                  </Badge>
                </div>
                {i.message && <p className="text-xs text-muted-foreground italic">"{i.message}"</p>}
                {i.status === "contacted" && p?.phone && (
                  <div className="text-xs text-green-500">{t("backingProfile.phoneRevealed", { phone: p.phone })}</div>
                )}
                {i.status === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => updateStatus(i.id, "contacted")}>
                      <Check className="w-3 h-3 mr-1" /> {t("backingProfile.acceptReveal")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => updateStatus(i.id, "declined")}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
    <UpcomingEventsManager />
    <ResultsManager />
    </div>
  );
};
