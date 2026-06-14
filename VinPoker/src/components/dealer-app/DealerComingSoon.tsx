import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Clock, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shown when the dealer app flag is OFF and the viewer isn't an admin/owner
 *  doing UAT. Keeps the unreleased app dark for everyone else. */
export function DealerComingSoon() {
  const { t } = useTranslation();
  const nav = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-background">
      <span className="grid place-items-center w-16 h-16 rounded-2xl bg-card border border-primary/30 text-primary">
        <Clock className="w-8 h-8" />
      </span>
      <h1 className="text-xl font-display font-bold text-foreground">
        {t("dealer.comingSoon.title", "Dealer App đang hoàn thiện")}
      </h1>
      <p className="text-sm text-muted-foreground max-w-xs">
        {t("dealer.comingSoon.body", "Cổng dealer sẽ sớm ra mắt. Vui lòng quay lại sau.")}
      </p>
      <Button variant="outline" onClick={() => nav("/")}>
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        {t("dealer.back", "Về trang chủ")}
      </Button>
    </div>
  );
}
