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
import { ShieldAlert, CheckCircle2, Clock, Loader2, KeyRound, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";

// Editable Telegram + Facebook config. Telegram: dedicated chat id + OPTIONAL bot token (blank =
// shared VinPoker bot). Facebook: Page id + REQUIRED Page Access Token (pages_manage_posts). Tokens
// are WRITE-ONLY here — stored encrypted in Supabase Vault by marketing_set_telegram/_facebook and
// NEVER returned to the client (we only learn whether one is set). Zalo: coming soon.
const sb = supabase as any;

interface Props { clubId: string; clubName?: string; onChanged?: () => void }

export const ChannelSettings = ({ clubId, onChanged }: Props) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  // Telegram
  const [tgEnabled, setTgEnabled] = useState(false);
  const [chatId, setChatId] = useState("");
  const [tgHasToken, setTgHasToken] = useState(false);
  const [tgToken, setTgToken] = useState("");
  // Facebook
  const [fbEnabled, setFbEnabled] = useState(false);
  const [pageId, setPageId] = useState("");
  const [fbHasToken, setFbHasToken] = useState(false);
  const [fbToken, setFbToken] = useState("");
  const [showFbGuide, setShowFbGuide] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    try {
      const [tg, fb] = await Promise.all([
        sb.rpc("marketing_get_telegram_config", { p_club_id: clubId }),
        sb.rpc("marketing_get_facebook_config", { p_club_id: clubId }),
      ]);
      const t1 = tg?.data;
      if (!tg?.error && !t1?.error) { setTgEnabled(!!t1?.enabled); setChatId((t1?.chat_id as string) ?? ""); setTgHasToken(!!t1?.has_custom_token); }
      const f1 = fb?.data;
      if (!fb?.error && !f1?.error) { setFbEnabled(!!f1?.enabled); setPageId((f1?.page_id as string) ?? ""); setFbHasToken(!!f1?.has_token); }
      setTgToken(""); setFbToken("");
    } catch {
      /* leave defaults */
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  const saveTelegram = async (botTokenArg: string | null) => {
    if (!chatId.trim()) { toast.error(t("marketing.channels.errChatId")); return; }
    setBusy(true);
    try {
      const { data, error } = await sb.rpc("marketing_set_telegram", { p_club_id: clubId, p_chat_id: chatId.trim(), p_bot_token: botTokenArg });
      if (error || data?.error) { toast.error(error?.message ?? data?.error ?? "error"); return; }
      toast.success(t("marketing.channels.saved")); onChanged?.(); await load();
    } finally { setBusy(false); }
  };

  const saveFacebook = async (tokenArg: string | null) => {
    if (!pageId.trim()) { toast.error(t("marketing.channels.errPageId")); return; }
    setBusy(true);
    try {
      const { data, error } = await sb.rpc("marketing_set_facebook", { p_club_id: clubId, p_page_id: pageId.trim(), p_page_token: tokenArg });
      if (error || data?.error) { toast.error(error?.message ?? data?.error ?? "error"); return; }
      toast.success(t("marketing.channels.saved")); onChanged?.(); await load();
    } finally { setBusy(false); }
  };

  if (loading) return <Skeleton className="h-72 w-full" />;

  const statusBadge = (ready: boolean) => ready
    ? <Badge className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" />{t("marketing.channels.statusReady")}</Badge>
    : <Badge variant="outline" className="gap-1"><Clock className="h-3.5 w-3.5" />{t("marketing.channels.statusNotConfigured")}</Badge>;

  return (
    <div className="space-y-4">
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="flex gap-2 py-3 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>{t("marketing.channels.intro")}</span>
        </CardContent>
      </Card>

      {/* Telegram */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">Telegram {statusBadge(tgEnabled && !!chatId)}</CardTitle>
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
              {tgHasToken && <Badge variant="secondary" className="ml-1">{t("marketing.channels.tokenSet")}</Badge>}
            </Label>
            <Input type="password" value={tgToken} onChange={(e) => setTgToken(e.target.value)} autoComplete="off"
              placeholder={tgHasToken ? t("marketing.channels.botTokenKeep") : t("marketing.channels.botTokenPlaceholder")} />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("marketing.channels.botTokenHelp")}</p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={() => saveTelegram(tgToken.trim() ? tgToken.trim() : null)} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{t("marketing.channels.save")}
            </Button>
            {tgHasToken && <Button variant="outline" onClick={() => saveTelegram("")} disabled={busy}>{t("marketing.channels.useGlobalBot")}</Button>}
          </div>
        </CardContent>
      </Card>

      {/* Facebook */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">Facebook {statusBadge(fbEnabled && !!pageId)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Collapsible "how to get a Page Access Token" guide, right where the token is entered. */}
          <div className="rounded-md border border-border/50 bg-muted/20">
            <button
              type="button"
              onClick={() => setShowFbGuide((s) => !s)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-foreground"
            >
              <span className="flex items-center gap-1.5"><HelpCircle className="h-3.5 w-3.5 text-primary" />{t("marketing.channels.fbGuideTitle")}</span>
              {showFbGuide ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showFbGuide && (
              <div className="whitespace-pre-line px-3 pb-3 text-[11px] leading-relaxed text-muted-foreground">
                {t("marketing.channels.fbGuide")}
              </div>
            )}
          </div>

          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">{t("marketing.channels.fbPageId")} *</Label>
            <Input value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="123456789012345" />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("marketing.channels.fbPageIdHelp")}</p>
          </div>
          <div>
            <Label className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" />{t("marketing.channels.fbPageToken")} {fbEnabled ? "" : "*"}
              {fbHasToken && <Badge variant="secondary" className="ml-1">{t("marketing.channels.tokenSet")}</Badge>}
            </Label>
            <Input type="password" value={fbToken} onChange={(e) => setFbToken(e.target.value)} autoComplete="off"
              placeholder={fbHasToken ? t("marketing.channels.botTokenKeep") : t("marketing.channels.fbPageTokenPlaceholder")} />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("marketing.channels.fbPageTokenHelp")}</p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={() => saveFacebook(fbToken.trim() ? fbToken.trim() : null)} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{t("marketing.channels.save")}
            </Button>
            {fbHasToken && <Button variant="outline" onClick={() => saveFacebook("")} disabled={busy}>{t("marketing.channels.fbClearToken")}</Button>}
          </div>
        </CardContent>
      </Card>

      {/* Zalo — coming soon */}
      <Card className="opacity-70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">Zalo OA<Badge variant="outline">{t("marketing.channels.comingSoon")}</Badge></CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t("marketing.channels.tokenNote")}</CardContent>
      </Card>
    </div>
  );
};
