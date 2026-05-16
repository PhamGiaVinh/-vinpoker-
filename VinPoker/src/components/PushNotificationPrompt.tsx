import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Share } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  initOneSignal,
  isOneSignalSupported,
  isIOSDevice,
  isStandalonePWA,
  requestPushPermission,
  getSubscriptionState,
} from "@/lib/onesignal";
import { toast } from "sonner";

const STORAGE_KEY = "push_prompt_seen_v2";
const DELAY_MS_WEB = 15_000;
// Khi mở từ PWA đã cài (standalone) → hiện prompt NGAY để user kịp bấm đồng ý
// trước khi bị phân tâm.
const DELAY_MS_PWA = 200;

export const PushNotificationPrompt = () => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isOneSignalSupported()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    const delay = isStandalonePWA() ? DELAY_MS_PWA : DELAY_MS_WEB;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const os = await initOneSignal();
      if (!os || cancelled) return;
      const state = await getSubscriptionState();
      if (state.permission === "granted" || state.permission === "denied") {
        localStorage.setItem(STORAGE_KEY, "1");
        return;
      }
      setOpen(true);
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  };

  const accept = async () => {
    const needsInstall = isIOSDevice() && !isStandalonePWA();
    if (needsInstall) {
      // iOS Safari will not show a permission prompt unless installed to Home Screen.
      toast.info(t("pushNotifications.iosHint"));
      localStorage.setItem(STORAGE_KEY, "1");
      setOpen(false);
      return;
    }
    const granted = await requestPushPermission(
      ["tournaments", "news", "tools"],
      i18n.language,
    );
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
    if (granted) toast.success(t("pushNotifications.subscribed"));
    else toast.error(t("pushNotifications.denied"));
  };

  const iosNeedsInstall = isIOSDevice() && !isStandalonePWA();

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : dismiss())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 rounded-full gradient-neon flex items-center justify-center mb-2">
            <Bell className="w-6 h-6 text-primary-foreground" />
          </div>
          <DialogTitle className="text-center">{t("pushNotifications.promptTitle")}</DialogTitle>
          <DialogDescription className="text-center">
            {t("pushNotifications.promptBody")}
          </DialogDescription>
        </DialogHeader>

        <ul className="text-sm space-y-1.5 text-muted-foreground">
          <li>• {t("pushNotifications.topicTournaments")}</li>
          <li>• {t("pushNotifications.topicNews")}</li>
          <li>• {t("pushNotifications.topicTools")}</li>
        </ul>

        {iosNeedsInstall && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <Share className="w-3.5 h-3.5" /> {t("pushNotifications.iosTitle")}
            </div>
            <p>{t("pushNotifications.iosHint")}</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={dismiss}>
            {t("pushNotifications.later")}
          </Button>
          <Button className="flex-1 gradient-neon text-primary-foreground border-0" onClick={accept}>
            {t("pushNotifications.allow")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
