import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { onSWUpdateAvailable, applyUpdate } from "@/lib/registerSW";

/**
 * Bottom banner that appears when a new service worker version is waiting.
 * - "Cập nhật" → activates the new SW immediately and reloads.
 * - Dismiss (×) → hides the banner; the new version will be applied silently
 *   the next time the user opens the app (browser will activate the waiting
 *   SW once all tabs are closed and reopened).
 */
export const UpdateBanner = () => {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    return onSWUpdateAvailable(() => setShow(true));
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-silent="true"
      className="fixed inset-x-0 z-[60] flex justify-center px-3 pointer-events-none"
      style={{
        bottom: "calc(env(safe-area-inset-bottom) + 88px)",
      }}
    >
      <div className="pointer-events-auto w-full max-w-md flex items-center gap-3 rounded-2xl border border-primary/30 bg-background/95 backdrop-blur-xl shadow-2xl shadow-primary/10 px-4 py-3 animate-fade-in">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground leading-tight">
            {t("updateBanner.newVersionTitle")}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {t("updateBanner.newVersionDesc")}
          </div>
        </div>
        <button
          type="button"
          onClick={applyUpdate}
          className="shrink-0 rounded-full gradient-neon text-primary-foreground border border-primary-foreground/20 shadow-neon px-4 h-9 text-xs font-bold tracking-wider uppercase hover:opacity-90 active:scale-95 transition-all"
        >
          {t("updateBanner.updateBtn")}
        </button>
        <button
          type="button"
          onClick={() => setShow(false)}
          aria-label={t("updateBanner.closeAria")}
          className="shrink-0 w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex items-center justify-center"
        >
          ×
        </button>
      </div>
    </div>
  );
};
