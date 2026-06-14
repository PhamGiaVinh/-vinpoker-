import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { Briefcase, Star, Trophy, GraduationCap, Globe, CheckCircle2 } from "lucide-react";
import { DEALER_GOLD } from "@/lib/dealerApp/constants";
import type { CareerProgramKind, CareerProgramView } from "@/types/dealerApp";

const ICON: Record<CareerProgramKind, LucideIcon> = {
  job: Briefcase,
  promotion: Star,
  senior_upgrade: Star,
  tournament: Trophy,
  skill: GraduationCap,
};

/** A program tile in the open dealer marketplace. Tapping opens the detail sheet. */
export function ProgramCard({
  program,
  applied,
  onOpen,
}: {
  program: CareerProgramView;
  applied?: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const Icon = ICON[program.kind] ?? Briefcase;
  const intl = program.region === "Intl";
  const chips = [program.payRange, program.location].filter(Boolean) as string[];

  return (
    <button
      onClick={onOpen}
      className="text-left rounded-2xl border border-primary/20 bg-card p-3.5 flex flex-col gap-1 min-h-[128px] hover:border-primary/45 transition-colors"
    >
      <div className="flex items-center justify-between">
        <Icon className="w-5 h-5 text-primary" />
        {applied ? (
          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-primary">
            <CheckCircle2 className="w-3 h-3" />
            {t("dealer.careers.applied", "Đã ứng tuyển")}
          </span>
        ) : intl ? (
          <span className="inline-flex items-center gap-1 text-[9px] font-bold" style={{ color: DEALER_GOLD }}>
            <Globe className="w-3 h-3" />
            {t("dealer.careers.intl", "Quốc tế")}
          </span>
        ) : null}
      </div>
      <div className="text-[13px] font-bold text-foreground leading-tight mt-1">{program.title}</div>
      <div className="text-[11px] text-muted-foreground leading-snug">{program.subtitle}</div>
      <div className="mt-auto flex flex-wrap gap-1 pt-1">
        {chips.map((c, i) => (
          <span
            key={i}
            className="text-[9px] font-bold rounded-md px-1.5 py-0.5 bg-muted/60"
            style={i === 0 ? { color: DEALER_GOLD } : undefined}
          >
            {c}
          </span>
        ))}
      </div>
    </button>
  );
}
