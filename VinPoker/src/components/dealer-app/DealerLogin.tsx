import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Spade, LogIn, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackButton } from "@/components/BackButton";
import { DEALER_EMAIL_DOMAIN } from "@/lib/dealerApp/constants";

/**
 * Dealer-app login (shown by DealerAppShell when live + not signed in). Dealers
 * log in with the account code + temp password the Telegram bot sent — NO email
 * to type. The code is the email local-part; we append "@DEALER_EMAIL_DOMAIN"
 * before calling Supabase. A full email is also accepted (if it contains "@").
 * First-time dealers normally just tap the one-tap link in Telegram instead.
 */
export function DealerLogin() {
  const { t } = useTranslation();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const signIn = async () => {
    const handle = account.trim();
    if (!handle || !password) {
      toast.error(t("dealer.login.missing", "Nhập tài khoản và mật khẩu."));
      return;
    }
    const email = handle.includes("@") ? handle : `${handle}@${DEALER_EMAIL_DOMAIN}`;
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      toast.error(t("dealer.login.failed", "Sai tài khoản hoặc mật khẩu."));
      return;
    }
    toast.success(t("dealer.login.ok", "Đăng nhập thành công."));
    // AuthProvider updates `user` → DealerAppShell re-renders into the app.
  };

  return (
    <div className="min-h-screen flex flex-col bg-background px-4 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto w-full max-w-sm flex-1 flex flex-col justify-center py-10">
        <BackButton to="/" label={t("dealer.exitToMain", "Về app chính")} className="self-start mb-4" />

        <div className="flex items-center gap-2 mb-6">
          <span className="grid place-items-center w-11 h-11 rounded-xl bg-card border border-primary/30 text-primary">
            <Spade className="w-6 h-6" />
          </span>
          <div className="leading-tight">
            <div className="text-base font-display font-black tracking-[0.14em] text-primary">VBACKER</div>
            <div className="text-[12px] text-muted-foreground -mt-0.5">
              {t("dealer.login.title", "Đăng nhập dealer")}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("dealer.login.account", "Tài khoản")}</Label>
            <Input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder={t("dealer.login.accountPlaceholder", "Mã tài khoản bot gửi (vd dlr2cl8gqg)")}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("dealer.login.password", "Mật khẩu")}</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={(e) => e.key === "Enter" && signIn()}
            />
          </div>

          <Button
            onClick={signIn}
            disabled={submitting}
            className="w-full gradient-neon text-primary-foreground border-0 font-bold"
          >
            {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <LogIn className="w-4 h-4 mr-1.5" />}
            {t("dealer.login.submit", "Đăng nhập")}
          </Button>

          <p className="text-[12px] text-muted-foreground text-center leading-relaxed pt-1">
            {t(
              "dealer.login.hint",
              "Lần đầu? Mở Telegram và bấm link đăng nhập 1 chạm bot đã gửi, hoặc gõ /setup để nhận tài khoản.",
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
