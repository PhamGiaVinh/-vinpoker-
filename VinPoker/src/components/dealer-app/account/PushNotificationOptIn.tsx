import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { getSubscriptionState, requestPushPermission, isOneSignalSupported } from "@/lib/onesignal";

/**
 * "🔔 Bật thông báo ca làm" — dealer-app opt-in for OneSignal web push (owner
 * request 2026-07-04: "chuẩn bị kết nối với OneSignal sẵn" for the pre-shift
 * reminders). OneSignal is already initialized app-wide (main.tsx) and linked to
 * this dealer's auth uid on login (useAuth.tsx) — this card is just the missing
 * "please allow notifications" prompt so the push channel actually has a
 * subscribed device to send to. Frontend-only, no DB/RPC/Edge change.
 */
export function PushNotificationOptIn() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "granted" | "default" | "denied" | "unsupported">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isOneSignalSupported()) {
        if (alive) setState("unsupported");
        return;
      }
      const s = await getSubscriptionState();
      if (alive) setState(s.permission === "granted" && s.optedIn ? "granted" : s.permission === "denied" ? "denied" : "default");
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state === "unsupported" || state === "granted") return null;

  const enable = async () => {
    setBusy(true);
    try {
      const granted = await requestPushPermission();
      setState(granted ? "granted" : "denied");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3.5 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <Bell className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-foreground">
            {t("dealer.account.pushOptIn.title", "Bật thông báo ca làm")}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {state === "denied"
              ? t("dealer.account.pushOptIn.denied", "Trình duyệt đã chặn — bật lại trong cài đặt trình duyệt.")
              : t("dealer.account.pushOptIn.subtitle", "Nhận nhắc trước giờ ca ngay trên điện thoại.")}
          </div>
        </div>
      </div>
      {state !== "denied" && (
        <button
          onClick={enable}
          disabled={busy}
          className="shrink-0 rounded-full bg-primary text-primary-foreground text-[12px] font-bold px-3.5 py-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t("dealer.account.pushOptIn.enable", "Bật")}
        </button>
      )}
      {state === "denied" && <BellOff className="w-4 h-4 text-muted-foreground shrink-0" />}
    </div>
  );
}
