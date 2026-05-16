import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bell, CheckCircle2, XCircle, AlertCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  initOneSignal,
  isOneSignalSupported,
  getSubscriptionState,
} from "@/lib/onesignal";

const LAST_TEST_KEY = "push_last_test_at";

type Diag = {
  sdk: "initialized" | "not_initialized" | "unsupported";
  permission: "granted" | "denied" | "default";
  optedIn: boolean;
  externalId: string | null;
};

export const PushDiagnostics = () => {
  const { user } = useAuth();
  const [diag, setDiag] = useState<Diag | null>(null);
  const [lastTest, setLastTest] = useState<string | null>(
    localStorage.getItem(LAST_TEST_KEY),
  );

  const refresh = async () => {
    if (!isOneSignalSupported()) {
      setDiag({ sdk: "unsupported", permission: "default", optedIn: false, externalId: null });
      return;
    }
    const os = await initOneSignal();
    const state = await getSubscriptionState();
    let externalId: string | null = null;
    try {
      externalId = (os as any)?.User?.externalId ?? null;
    } catch {}
    setDiag({
      sdk: os ? "initialized" : "not_initialized",
      permission: state.permission,
      optedIn: state.optedIn,
      externalId,
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  const test = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Bạn cần đăng nhập");
      const { data, error } = await supabase.functions.invoke("send-push-notification", {
        body: {
          user_id: user.id,
          heading: "Vin Poker",
          message: "✅ Test notification — pipeline đang hoạt động!",
          url: window.location.origin + "/account",
        },
      });
      if (error) throw error;
      if (data?.warning) throw new Error(data.warning);
      return data;
    },
    onSuccess: () => {
      const now = new Date().toISOString();
      localStorage.setItem(LAST_TEST_KEY, now);
      setLastTest(now);
      toast.success("✅ Test notification đã gửi!");
    },
    onError: (e: any) => {
      toast.error(`❌ Thất bại: ${e?.message ?? "unknown"}`);
    },
  });

  return (
    <Card className="p-4 space-y-3 bg-card/60">
      <div className="flex items-center gap-2 text-gold font-semibold">
        <Bell className="w-4 h-4" /> Chẩn đoán Push Notification
      </div>

      <div className="space-y-1.5 text-sm">
        <Row label="SDK" value={diag?.sdk ?? "..."} ok={diag?.sdk === "initialized"} />
        <Row
          label="Quyền (permission)"
          value={diag?.permission ?? "..."}
          ok={diag?.permission === "granted"}
          warn={diag?.permission === "default"}
        />
        <Row
          label="Đã subscribe"
          value={diag ? (diag.optedIn ? "subscribed" : "not subscribed") : "..."}
          ok={!!diag?.optedIn}
        />
        <Row
          label="External ID (OneSignal)"
          value={diag?.externalId ? diag.externalId.slice(0, 8) + "…" : "—"}
          ok={!!diag?.externalId}
          warn={!diag?.externalId}
        />
        <Row
          label="Test cuối"
          value={lastTest ? new Date(lastTest).toLocaleString("vi-VN") : "chưa gửi"}
          ok={!!lastTest}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={refresh} className="flex-1">
          Làm mới
        </Button>
        <Button
          size="sm"
          onClick={() => test.mutate()}
          disabled={test.isPending || !user || !diag?.optedIn}
          className="flex-1 gradient-neon text-primary-foreground border-0"
        >
          <Send className="w-4 h-4 mr-1.5" />
          {test.isPending ? "Đang gửi..." : "Gửi test"}
        </Button>
      </div>

      {!diag?.optedIn && diag?.sdk === "initialized" && (
        <p className="text-xs text-muted-foreground">
          Bật notification ở mục phía trên trước khi test.
        </p>
      )}
    </Card>
  );
};

const Row = ({
  label,
  value,
  ok,
  warn,
}: {
  label: string;
  value: string;
  ok?: boolean;
  warn?: boolean;
}) => {
  const Icon = ok ? CheckCircle2 : warn ? AlertCircle : XCircle;
  const color = ok ? "text-emerald-500" : warn ? "text-amber-500" : "text-red-500";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-mono text-xs">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        {value}
      </span>
    </div>
  );
};
