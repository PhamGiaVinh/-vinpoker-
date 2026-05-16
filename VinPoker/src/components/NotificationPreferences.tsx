import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BellOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  initOneSignal,
  isOneSignalSupported,
  isIOSDevice,
  isStandalonePWA,
  getSubscriptionState,
  requestPushPermission,
  setTopic,
  optOutPush,
  optInPush,
  type Topic,
} from "@/lib/onesignal";
import { toast } from "sonner";

type State = {
  loading: boolean;
  permission: "granted" | "denied" | "default";
  optedIn: boolean;
  tournaments: boolean;
  news: boolean;
  tools: boolean;
};

const DEFAULT: State = {
  loading: true,
  permission: "default",
  optedIn: false,
  tournaments: true,
  news: true,
  tools: true,
};

export const NotificationPreferences = () => {
  const { t, i18n } = useTranslation();
  const [s, setS] = useState<State>(DEFAULT);

  const refresh = async () => {
    const state = await getSubscriptionState();
    setS({
      loading: false,
      permission: state.permission,
      optedIn: state.optedIn,
      tournaments: state.tags.topic_tournaments !== "0",
      news: state.tags.topic_news !== "0",
      tools: state.tags.topic_tools !== "0",
    });
  };

  useEffect(() => {
    if (!isOneSignalSupported()) {
      setS((p) => ({ ...p, loading: false }));
      return;
    }
    initOneSignal().then(() => refresh());
  }, []);

  const supported = isOneSignalSupported();
  const iosNeedsInstall = isIOSDevice() && !isStandalonePWA();

  const enable = async () => {
    if (iosNeedsInstall) {
      toast.info(t("pushNotifications.iosHint"));
      return;
    }
    const granted = await requestPushPermission(
      [
        ...(s.tournaments ? (["tournaments"] as Topic[]) : []),
        ...(s.news ? (["news"] as Topic[]) : []),
        ...(s.tools ? (["tools"] as Topic[]) : []),
      ],
      i18n.language,
    );
    if (granted) toast.success(t("pushNotifications.subscribed"));
    else toast.error(t("pushNotifications.denied"));
    await refresh();
  };

  const disable = async () => {
    await optOutPush();
    toast.success(t("pushNotifications.unsubscribed"));
    await refresh();
  };

  const reEnable = async () => {
    await optInPush();
    await refresh();
  };

  const toggle = async (topic: Topic, value: boolean) => {
    setS((p) => ({ ...p, [topic]: value }));
    await setTopic(topic, value);
  };

  if (!supported) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("pushNotifications.unsupported")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-gold font-semibold">
        <Bell className="w-4 h-4" /> {t("pushNotifications.sectionTitle")}
      </div>

      {s.permission !== "granted" || !s.optedIn ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {s.permission === "denied"
              ? t("pushNotifications.deniedHelp")
              : t("pushNotifications.notSubscribed")}
          </p>
          {s.permission !== "denied" && (
            <Button
              onClick={s.permission === "granted" ? reEnable : enable}
              className="w-full gradient-neon text-primary-foreground border-0"
              disabled={s.loading}
            >
              <Bell className="w-4 h-4 mr-2" />
              {t("pushNotifications.enableButton")}
            </Button>
          )}
          {iosNeedsInstall && (
            <p className="text-xs text-muted-foreground">{t("pushNotifications.iosHint")}</p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <Row
              label={t("pushNotifications.topicTournaments")}
              checked={s.tournaments}
              onChange={(v) => toggle("tournaments", v)}
            />
            <Row
              label={t("pushNotifications.topicNews")}
              checked={s.news}
              onChange={(v) => toggle("news", v)}
            />
            <Row
              label={t("pushNotifications.topicTools")}
              checked={s.tools}
              onChange={(v) => toggle("tools", v)}
            />
          </div>
          <Button variant="outline" onClick={disable} className="w-full">
            <BellOff className="w-4 h-4 mr-2" />
            {t("pushNotifications.disableButton")}
          </Button>
        </>
      )}
    </div>
  );
};

const Row = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <div className="flex items-center justify-between">
    <span className="text-sm">{label}</span>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);
