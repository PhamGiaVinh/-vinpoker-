import { useTranslation } from "react-i18next";
import { BadgeCheck, ShieldQuestion, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDealerLink } from "@/hooks/dealer/useDealerLink";

/** Region + verification status (open-market / international identity), sourced
 *  from `profiles` via the dealer link. Read-only display. */
export function VerificationStatusCard() {
  const { t } = useTranslation();
  const { dealer } = useDealerLink();
  const verified = !!dealer?.isVerified;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 mb-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">{t("dealer.onboarding.identityTitle", "Hồ sơ & xác minh")}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border",
            verified ? "text-primary border-primary/40 bg-primary/10" : "text-warning border-warning/30 bg-warning/10"
          )}
        >
          {verified ? <BadgeCheck className="w-3.5 h-3.5" /> : <ShieldQuestion className="w-3.5 h-3.5" />}
          {verified ? t("dealer.onboarding.verified", "Đã xác minh") : t("dealer.onboarding.unverified", "Chưa xác minh")}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-2 text-[13px]">
        <MapPin className="w-4 h-4 text-muted-foreground" />
        <span className="text-muted-foreground">{t("dealer.onboarding.region", "Khu vực")}:</span>
        <span className="font-bold text-foreground">{dealer?.region || "—"}</span>
      </div>
      {!verified && (
        <p className="text-[11px] text-muted-foreground mt-2">
          {t("dealer.onboarding.verifyHint", "Hoàn tất xác minh để mở khóa cơ hội quốc tế.")}
        </p>
      )}
    </div>
  );
}
