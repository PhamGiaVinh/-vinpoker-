import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ShieldAlert, CheckCircle2, Clock, Loader2, KeyRound } from "lucide-react";

// Editable marketing-Telegram config: a DEDICATED chat id (so marketing doesn't post to the dealer
// group) + an OPTIONAL per-club bot token. The token is WRITE-ONLY here: it's stored encrypted in
// Supabase Vault by marketing_set_telegram and is NEVER returned to the client (we only learn
// whether one is set). Blank token = use the shared VinPoker bot.
const sb = supabase as any;

interface Props { clubId: string; clubName?: string; onChanged?: () => void }

export const ChannelSettings = ({ clubId, onChanged }: Props) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [chatId, setChatId] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    try {
      const { data, error } = await sb.rpc("marketing_get_telegram_config", { p_club_id: clubId });
      if (error || data?.error) { setEnabled(false); setChatId(""); setHasToken(false); }
      else {
        setEnabled(!!data?.enabled);
        setChatId((data?.chat_id as string) ?? "");
        setHasToken(!!data?.has_custom_token);
      }
      setToken("");
    } catch {
      setEnabled(false); setChatId(""); setHasToken(false);
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  // p_bot_token: undefined→null (keep), a value→store, '' (sentinel)→clear to global bot.
  const save = async (botTokenArg: string | null) => {
    if (!chatId.trim()) { toast.error(t("marketing.channels.errChatId")); return; }
    setBusy(true);
    try {
      const { data, error } = await sb.rpc("marketing_set_telegram", {
        p_club_id: clubId,
        p_chat_id: chatId.trim(),
        p_bot_token: botTokenArg,
      });
      if (error || data?.error) { toast.error(error?.message ?? data?.error ?? "error"); return; }
      toast.success(t("marketing.channels.saved"));
      onChanged?.();
      await load();
    } finally { setBusy(false); }
  };

  if (loading) return <Skeleton className="h-56 w-full" />;

  return (
    <div className="space-y-4">
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="flex gap-2 py-3 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>{t("marketing.channels.intro")}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            Telegram
            {enabled && chatId ? (
              <Badge className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" />{t("marketing.channels.statusReady")}</Badge>
            ) : (
              <Badge variant="outline" className="gap-1"><Clock className="h-3.5 w-3.5" />{t("marketing.channels.statusNotConfigured")}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("marketing.channels.chatId")} *</Label>
            <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("marketing.channels.chatIdHelp")}</p>
          </div>

          <div>
            <Label className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" />{t("marketing.channels.botToken")}
              {hasToken && <Badge variant="secondary" className="ml-1">{t("marketing.channels.tokenSet")}</Badge>}
            </Label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={hasToken ? t("marketing.channels.botTokenKeep") : t("marketing.channels.botTokenPlaceholder")}
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("marketing.channels.botTokenHelp")}</p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={() => save(token.trim() ? token.trim() : null)} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {t("marketing.channels.save")}
            </Button>
            {hasToken && (
              <Button variant="outline" onClick={() => save("")} disabled={busy}>
                {t("marketing.channels.useGlobalBot")}
              </Button>
            )}
          </div>
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
