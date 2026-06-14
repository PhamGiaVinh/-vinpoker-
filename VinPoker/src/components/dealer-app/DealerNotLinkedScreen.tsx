import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { UserPlus, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";

/** In-shell state for an authenticated user whose account isn't linked to a
 *  dealer record. The Careers/marketplace tab stays reachable (open market), so
 *  un-hired applicants can still browse & apply. */
export function DealerNotLinkedScreen() {
  const { t } = useTranslation();
  const nav = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="grid place-items-center w-16 h-16 rounded-2xl bg-card border border-primary/30 text-primary">
        <UserPlus className="w-8 h-8" />
      </span>
      <h2 className="text-lg font-display font-bold text-foreground">
        {t("dealer.notLinked.title", "Tài khoản chưa liên kết dealer")}
      </h2>
      <p className="text-sm text-muted-foreground max-w-xs">
        {t(
          "dealer.notLinked.body",
          "Tài khoản của bạn chưa được liên kết với hồ sơ dealer. Bạn vẫn có thể xem cơ hội tuyển dụng và ứng tuyển."
        )}
      </p>
      <Button
        className="gradient-neon text-primary-foreground border-0 font-bold"
        onClick={() => nav("/dealer/careers")}
      >
        <Briefcase className="w-4 h-4 mr-1.5" />
        {t("dealer.notLinked.cta", "Xem tuyển dụng")}
      </Button>
    </div>
  );
}
