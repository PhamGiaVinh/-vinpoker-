import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { Briefcase, Star, Trophy, GraduationCap, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEALER_GOLD } from "@/lib/dealerApp/constants";
import type { CareerProgramKind, CareerProgramView } from "@/types/dealerApp";

const ICON: Record<CareerProgramKind, LucideIcon> = {
  job: Briefcase,
  promotion: Star,
  senior_upgrade: Star,
  tournament: Trophy,
  skill: GraduationCap,
};

/** A program tile in the open dealer marketplace. Inc 1: tapping shows a preview
 *  toast; the live apply flow + detail sheet land in Inc 5–7. */
export function ProgramCard({ program }: { program: CareerProgramView }) {
  const { t } = useTranslation();
  const Icon = ICON[program.kind] ?? Briefcase;
  const intl = program.region === "Intl";
  const chips = [program.payRange, program.location].filter(Boolean) as string[];

  return (
    <button
      onClick={() => toast.info(t("dealer.toast.previewOnly", "Bản xem trước — thao tác sẽ bật khi triển khai"))}
      className="text-left rounded-2xl border border-primary/20 bg-card p-3.5 flex flex-col gap-1 min-h-[124px] hover:border-primary/45 transition-colors"
    >
      <div className="flex items-center justify-between">
        <Icon className="w-5 h-5 text-primary" />
        {intl && (
          <span className="inline-flex items-center gap-1 text-[9px] font-bold" style={{ color: DEALER_GOLD }}>
            <Globe className="w-3 h-3" />
            {t("dealer.careers.intl", "Quốc tế")}
          </span>
        )}
      </div>
      <div className="text-[13px] font-bold text-foreground leading-tight mt-1">{program.title}</div>
      <div className="text-[11px] text-muted-foreground leading-snug">{program.subtitle}</div>
      <div className="mt-auto flex flex-wrap gap-1 pt-1">
        {chips.map((c, i) => (
          <span
            key={i}
            className={cn("text-[9px] font-bold rounded-md px-1.5 py-0.5 bg-muted/60", i === 0 && "text-foreground")}
            style={i === 0 ? { color: DEALER_GOLD } : undefined}
          >
            {c}
          </span>
        ))}
      </div>
    </button>
  );
}
