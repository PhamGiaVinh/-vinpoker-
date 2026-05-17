import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const VerifyEmail = () => {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    if (!user?.email) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: user.email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success(t("verifyEmail.resentOk"));
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md gradient-card border-gold p-6 shadow-gold space-y-4 text-center">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center">
            <Mail className="w-7 h-7 text-primary" />
          </div>
        </div>
        <h1 className="font-display text-xl text-gold">{t("verifyEmail.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("verifyEmail.sentTo")}{" "}
          <span className="text-foreground font-semibold">{user?.email ?? t("verifyEmail.yourEmail")}</span>.
          <br />
          {t("verifyEmail.openLink")}
        </p>
        <div className="space-y-2 pt-2">
          <Button
            onClick={resend}
            disabled={busy}
            className="w-full gradient-gold text-primary-foreground border-0"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t("verifyEmail.resend")}
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={async () => {
              await signOut();
              nav("/auth");
            }}
          >
            {t("verifyEmail.signOut")}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground pt-2">
          {t("verifyEmail.noEmail")}
        </p>
      </Card>
    </div>
  );
};

export default VerifyEmail;
