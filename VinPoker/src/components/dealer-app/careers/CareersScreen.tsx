import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Globe, Headphones } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDealerCareers } from "@/hooks/dealer/useDealerCareers";
import { DEALER_GOLD } from "@/lib/dealerApp/constants";
import { ProgramCard } from "./ProgramCard";

/**
 * Open dealer marketplace + careers hub. Visible to ANY authenticated user (not
 * just linked dealers) so un-hired applicants can browse & apply — the open-market
 * entry point. Inc 1 = mock programs; full apply / detail / training flows = Inc 5–7.
 */
export function CareersScreen() {
  const { t } = useTranslation();
  const { data: programs, isLoading } = useDealerCareers();

  return (
    <div>
      <h1 className="text-xl font-display font-bold text-foreground mb-3">
        {t("dealer.careers.title", "Tuyển dụng & Đào tạo")}
      </h1>

      <div className="relative overflow-hidden rounded-2xl border border-[#E6B84C]/35 bg-card p-4 mb-4">
        <Globe className="absolute right-3 top-3 w-14 h-14 opacity-10" style={{ color: DEALER_GOLD }} />
        <div className="text-[11px] text-muted-foreground">{t("dealer.careers.heroSmall", "Phát triển sự nghiệp cùng")}</div>
        <div className="text-lg font-display font-black" style={{ color: DEALER_GOLD }}>
          VBACKER DEALER
        </div>
        <div className="text-[12px] text-muted-foreground mt-0.5">
          {t("dealer.careers.heroSub", "Sàn dealer mở · Cơ hội trong nước & quốc tế")}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[124px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(programs ?? []).map((p) => (
            <ProgramCard key={p.id} program={p} />
          ))}
        </div>
      )}

      <button
        onClick={() => toast.info(t("dealer.toast.previewOnly", "Bản xem trước — thao tác sẽ bật khi triển khai"))}
        className="mt-3 w-full flex items-center justify-between rounded-2xl border border-primary/25 bg-primary/5 p-4 font-bold text-primary"
      >
        <span className="flex items-center gap-2">
          <Headphones className="w-4 h-4" />
          {t("dealer.careers.contactHr", "Liên hệ Phòng Nhân sự")}
        </span>
        <span>›</span>
      </button>
    </div>
  );
}
