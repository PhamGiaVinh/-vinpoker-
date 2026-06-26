import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2, Bot, Info } from "lucide-react";

// Auto-content config: per club, enable bots that generate marketing post DRAFTS from ops data
// (schedule / livestream / overlay). Generated posts are NEVER auto-sent — the owner reviews and
// publishes them from the "Bài viết" tab. Reads/writes via marketing_get/set_auto_job (owner-gated).
const sb = supabase as any;

const KINDS = ["schedule", "livestream", "overlay"] as const;
const AUTO_CHANNELS = ["telegram", "facebook"] as const;

interface Props { clubId: string; onChanged?: () => void }

export const MarketingAutomation = ({ clubId, onChanged }: Props) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [kinds, setKinds] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    try {
      const { data, error } = await sb.rpc("marketing_get_auto_job", { p_club_id: clubId });
      if (error || data?.error) { setEnabled(false); setKinds([]); setChannels([]); return; }
      setEnabled(!!data?.enabled);
      setKinds(Array.isArray(data?.kinds) ? data.kinds : []);
      setChannels(Array.isArray(data?.channels) ? data.channels : []);
    } catch {
      setEnabled(false); setKinds([]); setChannels([]);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (list: string[], v: string, on: boolean) =>
    on ? Array.from(new Set([...list, v])) : list.filter((x) => x !== v);

  const onSave = async () => {
    setBusy(true);
    try {
      const { data, error } = await sb.rpc("marketing_set_auto_job", {
        p_club_id: clubId,
        p_enabled: enabled,
        p_kinds: kinds,
        p_channels: channels,
      });
      if (error || data?.error) { toast.error(error?.message ?? data?.error ?? "error"); return; }
      toast.success(t("marketing.auto.saved"));
      onChanged?.();
      await load();
    } finally { setBusy(false); }
  };

  if (loading) return <Skeleton className="h-72 w-full" />;

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex gap-2 py-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{t("marketing.auto.intro")}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-primary" />{t("marketing.auto.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 p-3">
            <div>
              <Label className="text-sm">{t("marketing.auto.enable")}</Label>
              <p className="text-[11px] text-muted-foreground">{t("marketing.auto.enableHelp")}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${enabled ? "text-primary" : "text-muted-foreground"}`}>
                {enabled ? t("marketing.auto.stateOn") : t("marketing.auto.stateOff")}
              </span>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">{t("marketing.auto.kinds")}</Label>
            <div className="space-y-2">
              {KINDS.map((k) => (
                <label key={k} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={kinds.includes(k)}
                    onCheckedChange={(v) => setKinds((prev) => toggle(prev, k, !!v))}
                  />
                  <span>
                    <span className="font-medium text-foreground">{t(`marketing.auto.kind.${k}`)}</span>
                    <span className="block text-[11px] text-muted-foreground">{t(`marketing.auto.kindHelp.${k}`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">{t("marketing.auto.channels")}</Label>
            <div className="flex flex-wrap gap-4">
              {AUTO_CHANNELS.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={channels.includes(c)}
                    onCheckedChange={(v) => setChannels((prev) => toggle(prev, c, !!v))}
                  />
                  {c === "telegram" ? "Telegram" : "Facebook"}
                </label>
              ))}
            </div>
          </div>

          <Button onClick={onSave} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{t("marketing.auto.save")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
