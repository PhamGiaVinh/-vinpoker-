import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Share, ExternalLink, AlertTriangle, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { isIOS, isInAppBrowser, openInExternalBrowser } from "@/lib/openExternal";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (window.navigator as any).standalone === true;

export const InstallPWAButton = () => {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHelpOpen, setIosHelpOpen] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const installedHandler = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const handleInstall = async () => {
    // If we're inside an in-app browser (Facebook/Zalo/...) PWA install
    // does NOT work — show the help dialog with the external-browser hint.
    if (isInAppBrowser()) {
      setIosHelpOpen(true);
      return;
    }
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") setDeferred(null);
    } else {
      setIosHelpOpen(true);
    }
  };

  if (installed) return null;

  const inApp = isInAppBrowser();
  const ios = isIOS();

  return (
    <>
      <button
        onClick={handleInstall}
        aria-label={t("installPwa.installAppAria")}
        className="fixed z-50 right-3 md:right-6 bottom-[calc(88px+env(safe-area-inset-bottom))] md:bottom-6 inline-flex items-center gap-1.5 rounded-full gradient-neon text-primary-foreground border border-primary-foreground/20 shadow-neon px-3.5 h-10 text-xs font-bold tracking-wider uppercase hover:opacity-90 active:scale-95 transition-all animate-fade-in"
      >
        <Download className="w-4 h-4" />
        <span>{t("installPwa.installApp")}</span>
      </button>

      <Dialog open={iosHelpOpen} onOpenChange={setIosHelpOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("installPwa.dialogTitle")}</DialogTitle>
            <DialogDescription>
              {ios
                ? t("installPwa.iosNoAutoInstall")
                : t("installPwa.browserNoQuickInstall")}
            </DialogDescription>
          </DialogHeader>

          {inApp && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-bold text-amber-500 mb-1">
                    {t("installPwa.openedFromFacebookZalo")}
                  </div>
                  <p className="text-foreground/90 leading-relaxed">
                    {t("installPwa.inAppBrowserCantInstallPre")} <strong>{t("installPwa.cantInstall")}</strong>. {t("installPwa.pressButton")}{" "}
                    <MoreVertical className="inline w-3.5 h-3.5 -mt-0.5" />{" "}
                    <strong>{t("installPwa.threeDots")}</strong> {t("installPwa.atCorner")} <strong>{t("installPwa.topRight")}</strong> {t("installPwa.ofScreenSelect")}{" "}
                    <strong>"{ios ? t("installPwa.openInSafariOption") : t("installPwa.openInChromeOption")}"</strong>, {t("installPwa.thenComeBackPress")}{" "}
                    <strong>{t("installPwa.installApp")}</strong>.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => openInExternalBrowser()}
                className="w-full gap-2"
                variant="secondary"
                size="sm"
              >
                <ExternalLink className="w-4 h-4" />
                {t("installPwa.openWithBrowserNow", { browser: ios ? "Safari" : "Chrome" })}
              </Button>
            </div>
          )}

          {ios ? (
            <ol className="list-decimal pl-5 space-y-2 text-sm">
              <li>
                {t("installPwa.iosStep1Pre")} <Share className="inline w-4 h-4 -mt-0.5" /> <strong>{t("installPwa.shareLabel")}</strong> {t("installPwa.iosStep1Post")}
              </li>
              <li>
                {t("installPwa.iosStep2Pre")} <strong>"{t("installPwa.addToHomeScreen")}"</strong>.
              </li>
              <li>
                {t("installPwa.iosStep3Pre")} <strong>{t("installPwa.addLabel")}</strong> {t("installPwa.iosStep3Post")}
              </li>
            </ol>
          ) : (
            <ol className="list-decimal pl-5 space-y-2 text-sm">
              <li>{t("installPwa.androidStep1")}</li>
              <li>
                {t("installPwa.androidStep2Pre")} <strong>"{t("installPwa.installAppOption")}"</strong> {t("installPwa.or")} <strong>"{t("installPwa.addToHomeScreen")}"</strong>.
              </li>
              <li>{t("installPwa.androidStep3")}</li>
            </ol>
          )}
          <Button onClick={() => setIosHelpOpen(false)} className="w-full">{t("installPwa.gotIt")}</Button>
        </DialogContent>
      </Dialog>
    </>
  );
};
