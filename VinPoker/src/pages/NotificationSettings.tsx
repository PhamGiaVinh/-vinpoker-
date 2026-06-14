import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  getSubscriptionState,
  requestPushPermission,
  optOutPush,
  isOneSignalSupported,
} from "@/lib/onesignal";

type Prefs = {
  welcome?: boolean;
  staking?: boolean;
  important?: boolean;
  club?: boolean;
  news?: boolean;
  chat?: boolean;
};

// label/desc hold i18n keys, resolved via t() inside the component map.
const CATEGORIES: { key: keyof Prefs; label: string; desc: string }[] = [
  { key: "staking", label: "notifSettings.catStakingLabel", desc: "notifSettings.catStakingDesc" },
  { key: "important", label: "notifSettings.catImportantLabel", desc: "notifSettings.catImportantDesc" },
  { key: "news", label: "notifSettings.catNewsLabel", desc: "notifSettings.catNewsDesc" },
];

const PUSH_CATEGORIES: { key: string; label: string; desc: string }[] = [
  { key: "news", label: "notifSettings.pushNewsLabel", desc: "notifSettings.pushNewsDesc" },
  { key: "livestream", label: "notifSettings.pushLivestreamLabel", desc: "notifSettings.pushLivestreamDesc" },
  { key: "staking_highlight", label: "notifSettings.pushStakingHighlightLabel", desc: "notifSettings.pushStakingHighlightDesc" },
  { key: "important", label: "notifSettings.pushImportantLabel", desc: "notifSettings.pushImportantDesc" },
  { key: "tools", label: "notifSettings.pushToolsLabel", desc: "notifSettings.pushToolsDesc" },
];
// Note: chat & club categories are push-only (no email).


export default function NotificationSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [pushPrefs, setPushPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Web Push state
  const [pushPerm, setPushPerm] = useState<"granted" | "denied" | "default">("default");
  const [pushOptedIn, setPushOptedIn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const pushSupported = typeof window !== "undefined" && isOneSignalSupported();
  const isPreviewHost =
    typeof window !== "undefined" &&
    (window.location.hostname.includes("id-preview--") ||
      window.location.hostname.includes("lovableproject.com") ||
      window.location.hostname === "localhost");

  const refreshPush = async () => {
    if (!pushSupported || isPreviewHost) return;
    const s = await getSubscriptionState();
    setPushPerm(s.permission);
    setPushOptedIn(s.optedIn);
  };

  useEffect(() => {
    refreshPush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enablePush = async () => {
    setPushBusy(true);
    try {
      const ok = await requestPushPermission(["tournaments", "news", "tools"]);
      if (ok) toast.success(t("notifSettings.pushEnabled"));
      else toast.error(t("notifSettings.pushPermissionDenied"));
      await refreshPush();
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    setPushBusy(true);
    try {
      await optOutPush();
      toast.success(t("notifSettings.pushDisabled"));
      await refreshPush();
    } finally {
      setPushBusy(false);
    }
  };
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("email_notifications_enabled, email_prefs, push_prefs")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setEnabled(data.email_notifications_enabled ?? true);
        setPrefs((data.email_prefs as Prefs) ?? {});
        setPushPrefs(((data as any).push_prefs as Record<string, boolean>) ?? {});
      }
      setLoading(false);
    })();
  }, [user]);

  const togglePushPref = async (key: string, val: boolean) => {
    const next = { ...pushPrefs, [key]: val };
    setPushPrefs(next);
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ push_prefs: next } as any).eq("user_id", user.id);
    if (error) toast.error(t("notifSettings.saveFailed", { msg: error.message }));
  };

  const save = async (next: { enabled?: boolean; prefs?: Prefs }) => {
    if (!user) return;
    const payload: any = {};
    if (next.enabled !== undefined) payload.email_notifications_enabled = next.enabled;
    if (next.prefs) payload.email_prefs = next.prefs;
    const { error } = await supabase.from("profiles").update(payload).eq("user_id", user.id);
    if (error) toast.error(t("notifSettings.saveFailed", { msg: error.message }));
    else toast.success(t("notifSettings.saved"));
  };

  const togglePref = (key: keyof Prefs, val: boolean) => {
    const next = { ...prefs, [key]: val };
    setPrefs(next);
    save({ prefs: next });
  };

  if (loading) return <div className="container mx-auto p-6">{t("notifSettings.loading")}</div>;

  const subscribed = pushPerm === "granted" && pushOptedIn;

  return (
    <div className="container mx-auto p-4 max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{t("notifSettings.title")}</h1>

      {/* Web Push section */}
      <Card className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${subscribed ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
            {subscribed ? <BellRing className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
          </div>
          <div className="flex-1">
            <Label className="text-base font-semibold">{t("notifSettings.webPushLabel")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("notifSettings.webPushDesc")}
            </p>
          </div>
        </div>

        {!pushSupported && (
          <p className="text-xs text-muted-foreground">{t("notifSettings.notSupported")}</p>
        )}
        {isPreviewHost && (
          <p className="text-xs text-warning">
            {t("notifSettings.previewNoticePrefix")} <a className="underline" href="https://www.vinpoker.live" target="_blank" rel="noopener">https://www.vinpoker.live</a> {t("notifSettings.previewNoticeSuffix")}
          </p>
        )}
        {pushSupported && !isPreviewHost && (
          <>
            <div className="text-xs">
              {t("notifSettings.statusLabel")}{" "}
              {pushPerm === "denied" ? (
                <span className="text-destructive font-semibold">{t("notifSettings.statusBlocked")}</span>
              ) : subscribed ? (
                <span className="text-primary font-semibold">{t("notifSettings.statusOn")}</span>
              ) : pushPerm === "granted" ? (
                <span className="text-muted-foreground font-semibold">{t("notifSettings.statusGrantedNotSubscribed")}</span>
              ) : (
                <span className="text-muted-foreground font-semibold">{t("notifSettings.statusOff")}</span>
              )}
            </div>
            {pushPerm === "denied" ? (
              <p className="text-xs text-muted-foreground">
                {t("notifSettings.deniedHelp")}
              </p>
            ) : subscribed ? (
              <Button variant="outline" size="sm" onClick={disablePush} disabled={pushBusy}>
                {pushBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <BellOff className="w-3.5 h-3.5 mr-1.5" />}
                {t("notifSettings.disablePushBtn")}
              </Button>
            ) : (
              <Button onClick={enablePush} disabled={pushBusy} className="gradient-neon text-primary-foreground border-0">
                {pushBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <BellRing className="w-3.5 h-3.5 mr-1.5" />}
                {t("notifSettings.enablePushBtn")}
              </Button>
            )}
          </>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <Label className="text-base font-semibold">{t("notifSettings.pushByCategory")}</Label>
        <p className="text-xs text-muted-foreground">{t("notifSettings.pushByCategoryDesc")}</p>
        {PUSH_CATEGORIES.map((c) => (
          <div key={c.key} className="flex items-start justify-between gap-4 py-1.5 border-b border-border last:border-0">
            <div>
              <Label className="font-semibold">{t(c.label)}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{t(c.desc)}</p>
            </div>
            <Switch
              checked={pushPrefs[c.key] !== false}
              onCheckedChange={(v) => togglePushPref(c.key, v)}
            />
          </div>
        ))}
      </Card>

      <h2 className="text-xl font-bold pt-2">Email</h2>
      <Card className="p-4 flex items-center justify-between">
        <div>
          <Label className="text-base font-semibold">{t("notifSettings.emailMasterLabel")}</Label>
          <p className="text-sm text-muted-foreground">{t("notifSettings.emailMasterDesc")}</p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            setEnabled(v);
            save({ enabled: v });
          }}
        />
      </Card>

      <Card className="p-4 space-y-4">
        <p className="text-sm text-muted-foreground">{t("notifSettings.emailPickDesc")}</p>
        {CATEGORIES.map((c) => (
          <div key={c.key} className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0">
            <div>
              <Label className="font-semibold">{t(c.label)}</Label>
              <p className="text-xs text-muted-foreground mt-1">{t(c.desc)}</p>
            </div>
            <Switch
              disabled={!enabled}
              checked={prefs[c.key] ?? false}
              onCheckedChange={(v) => togglePref(c.key, v)}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}
