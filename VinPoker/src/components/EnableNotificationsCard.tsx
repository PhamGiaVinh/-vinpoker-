import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, AlertTriangle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  initOneSignal,
  isOneSignalSupported,
  isIOSDevice,
  isStandalonePWA,
  getSubscriptionState,
  requestPushPermission,
  optInPush,
} from "@/lib/onesignal";
import { toast } from "sonner";

const PRODUCTION_HOSTS = new Set([
  "vinpoker.live",
  "www.vinpoker.live",
  "vinpoker.lovable.app",
]);

const isProductionHost = () => {
  if (typeof window === "undefined") return false;
  return PRODUCTION_HOSTS.has(window.location.hostname);
};

type State = {
  loading: boolean;
  permission: "granted" | "denied" | "default";
  optedIn: boolean;
};

export const EnableNotificationsCard = () => {
  const { i18n } = useTranslation();
  const [s, setS] = useState<State>({
    loading: true,
    permission: "default",
    optedIn: false,
  });
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!isOneSignalSupported()) {
      setS({ loading: false, permission: "default", optedIn: false });
      return null;
    }
    await initOneSignal();
    const st = await getSubscriptionState();
    setS({ loading: false, permission: st.permission, optedIn: st.optedIn });
    return st;
  };

  // Poll subscription state for a few seconds — optedIn can lag after permission grant.
  const refreshUntilSubscribed = async (maxMs = 8000) => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const st = await refresh();
      if (st && st.permission === "granted" && st.optedIn) return true;
      if (st && st.permission === "denied") return false;
      await new Promise((r) => setTimeout(r, 800));
    }
    return false;
  };

  useEffect(() => {
    if (!isProductionHost()) {
      setS({ loading: false, permission: "default", optedIn: false });
      return;
    }
    refresh();
  }, []);

  // Hard guards: only on production + supported browser + not yet fully subscribed
  if (!isProductionHost()) return null;
  if (!isOneSignalSupported()) return null;
  if (s.loading) return null;
  if (s.permission === "granted" && s.optedIn) return null;

  const iosNeedsInstall = isIOSDevice() && !isStandalonePWA();

  const handleEnable = async () => {
    if (iosNeedsInstall) return;
    setBusy(true);
    try {
      const granted = await requestPushPermission(
        ["tournaments", "news", "tools"],
        i18n.language,
      );
      if (!granted) {
        await refresh();
        toast.error("Bạn chưa cấp quyền thông báo.");
        return;
      }
      const ok = await refreshUntilSubscribed();
      if (ok) toast.success("✅ Đã bật thông báo!");
      else toast.error("Đã cấp quyền nhưng chưa subscribe được. Vui lòng tải lại trang.");
    } finally {
      setBusy(false);
    }
  };

  const handleReOptIn = async () => {
    setBusy(true);
    try {
      await optInPush();
      const ok = await refreshUntilSubscribed();
      if (ok) toast.success("✅ Đã bật lại thông báo!");
      else toast.error("Chưa subscribe được. Vui lòng tải lại trang.");
    } finally {
      setBusy(false);
    }
  };

  const handleManualPermissionReset = async () => {
    setBusy(true);
    try {
      const granted = await requestPushPermission(
        ["tournaments", "news", "tools"],
        i18n.language,
      );
      if (!granted) {
        await refresh();
        toast.error("Trình duyệt vẫn đang chặn thông báo. Vui lòng kiểm tra lại quyền trang web.");
        return;
      }
      const ok = await refreshUntilSubscribed();
      if (ok) toast.success("✅ Đã bật thông báo!");
      else toast.error("Đã cấp quyền nhưng chưa subscribe được. Vui lòng tải lại trang.");
    } finally {
      setBusy(false);
    }
  };

  // State C: denied at browser level
  if (s.permission === "denied") {
    return (
      <Card className="p-5 border-destructive/40 bg-destructive/5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-destructive/15 p-2.5 shrink-0">
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">Thông báo đang bị chặn</h3>
            <p className="text-sm text-muted-foreground">
              Bạn đã từ chối quyền thông báo. Trình duyệt sẽ không hỏi lại — vui lòng bật
              lại thủ công theo hướng dẫn dưới đây.
            </p>
          </div>
        </div>

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="chrome">
            <AccordionTrigger className="text-sm">Chrome / Edge (máy tính)</AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-1">
              <p>1. Click biểu tượng 🔒 bên trái thanh địa chỉ.</p>
              <p>2. Chọn <b>Site settings</b> → <b>Notifications</b> → đổi sang <b>Allow</b>.</p>
              <p>3. Tải lại trang này.</p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="safari">
            <AccordionTrigger className="text-sm">Safari (macOS)</AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-1">
              <p>1. Mở menu <b>Safari → Settings → Websites → Notifications</b>.</p>
              <p>2. Tìm <b>vinpoker.live</b> trong danh sách và đổi sang <b>Allow</b>.</p>
              <p>3. Tải lại trang.</p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="ios">
            <AccordionTrigger className="text-sm">iPhone / iPad (PWA)</AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-1">
              <p>1. Mở app <b>Settings</b> của iPhone.</p>
              <p>2. Vào <b>Notifications → Vin Poker</b>.</p>
              <p>3. Bật <b>Allow Notifications</b>.</p>
              <p className="text-xs italic">Lưu ý: cần Add to Home Screen rồi mở từ icon trước.</p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="android">
            <AccordionTrigger className="text-sm">Android Chrome</AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-1">
              <p>1. Click biểu tượng ⓘ bên trái URL.</p>
              <p>2. Chọn <b>Permissions → Notifications → Allow</b>.</p>
              <p>3. Tải lại trang.</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Button variant="outline" size="sm" onClick={handleManualPermissionReset} disabled={busy} className="w-full">
          <RefreshCw className="w-4 h-4 mr-2" />
          {busy ? "Đang kiểm tra..." : "Đã bật xong, kiểm tra và bật lại"}
        </Button>
      </Card>
    );
  }

  // State A (default) and B (granted but opted-out)
  const isReEnable = s.permission === "granted" && !s.optedIn;

  return (
    <Card className="p-5 border-primary/30 bg-card/60 space-y-4">
      <div className="flex items-start gap-4">
        <div className="rounded-full bg-primary/15 p-3 shrink-0">
          <Bell className="w-8 h-8 text-primary" />
        </div>
        <div className="space-y-1.5 flex-1">
          <h3 className="text-lg font-semibold">
            Bật Thông báo để nhận kết quả giải đấu và deal mới
          </h3>
          <p className="text-sm text-muted-foreground">
            Nhận thông báo tức thì khi có giải đấu mới, kết quả staking, và cập nhật quan
            trọng — kể cả khi bạn không mở app.
          </p>
        </div>
      </div>

      {iosNeedsInstall ? (
        <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          Trên iPhone/iPad bạn cần <b>Add to Home Screen</b> rồi mở Vin Poker từ icon mới
          bật được thông báo.
        </div>
      ) : (
        <Button
          onClick={isReEnable ? handleReOptIn : handleEnable}
          disabled={busy}
          className="w-full gradient-neon text-primary-foreground border-0"
          size="lg"
        >
          <Bell className="w-5 h-5 mr-2" />
          {busy
            ? "Đang xử lý..."
            : isReEnable
            ? "Bật lại thông báo"
            : "Bật thông báo"}
        </Button>
      )}
    </Card>
  );
};
