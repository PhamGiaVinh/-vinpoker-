import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert, CheckCircle2, Clock } from "lucide-react";

// Read-only in P0. NO token / secret / arbitrary env-key inputs here: Telegram uses the global
// system bot + the club's linked chat (club_settings.telegram_chat_id); Facebook/Zalo come later
// with a per-club integration whose tokens live in Supabase Secrets/Vault (never typed in the UI).
const sb = supabase as any;

interface Props { clubId: string; clubName?: string; onChanged?: () => void }

export const ChannelSettings = ({ clubId }: Props) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    try {
      const { data, error } = await sb.rpc("marketing_list_enabled_channels", { p_club_id: clubId });
      if (error || data?.error) setEnabled([]);
      else setEnabled((data?.channels ?? []) as string[]);
    } catch {
      setEnabled([]);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Skeleton className="h-40 w-full" />;

  const telegramReady = enabled.includes("telegram");

  return (
    <div className="space-y-4">
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="flex gap-2 py-3 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>{t("marketing.channels.intro")}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Telegram</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-2 text-sm">
          {telegramReady ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-muted-foreground">{t("marketing.channels.telegramReady")}</span>
            </>
          ) : (
            <>
              <Clock className="h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">{t("marketing.channels.telegramNotLinked")}</span>
            </>
          )}
        </CardContent>
      </Card>

      {["Facebook", "Zalo OA"].map((label) => (
        <Card key={label} className="opacity-70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              {label}
              <Badge variant="outline">{t("marketing.channels.comingSoon")}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{t("marketing.channels.tokenNote")}</CardContent>
        </Card>
      ))}
    </div>
  );
};
