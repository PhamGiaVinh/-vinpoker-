import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export default function Unsubscribe() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  const handle = async () => {
    if (!email) {
      setStatus("error");
      setMsg(t("unsubscribe.missingEmail"));
      return;
    }
    setStatus("loading");
    const { data, error } = await supabase.functions.invoke("email-unsubscribe", {
      body: { email },
    });
    if (error || (data as any)?.error) {
      setStatus("error");
      setMsg((data as any)?.error || error?.message || t("unsubscribe.genericError"));
    } else {
      setStatus("done");
      setMsg(t("unsubscribe.success", { email }));
    }
  };

  // Auto-trigger if email param present
  useEffect(() => {
    if (email && status === "idle") handle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 text-center space-y-4">
        <h1 className="text-2xl font-bold text-foreground">{t("unsubscribe.title")}</h1>
        {status === "loading" && <p className="text-muted-foreground">{t("unsubscribe.processing")}</p>}
        {status === "done" && <p className="text-emerald-400">{msg}</p>}
        {status === "error" && <p className="text-destructive">{msg}</p>}
        {status === "error" && email && (
          <Button onClick={handle} variant="default">{t("unsubscribe.retry")}</Button>
        )}
        <p className="text-xs text-muted-foreground">
          {t("unsubscribe.footnote")}
        </p>
      </div>
    </div>
  );
}
