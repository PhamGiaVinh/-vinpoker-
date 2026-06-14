import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { Briefcase, Star, Trophy, GraduationCap, Globe, MapPin, Wallet, Check, CheckCircle2 } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { DEALER_GOLD } from "@/lib/dealerApp/constants";
import type { CareerProgramKind, CareerProgramView } from "@/types/dealerApp";

const ICON: Record<CareerProgramKind, LucideIcon> = {
  job: Briefcase,
  promotion: Star,
  senior_upgrade: Star,
  tournament: Trophy,
  skill: GraduationCap,
};

function Chip({ icon: Icon, text, gold }: { icon: LucideIcon; text: string; gold?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-bold rounded-md px-2 py-0.5 bg-muted/60"
      style={gold ? { color: DEALER_GOLD } : undefined}
    >
      <Icon className="w-3 h-3" />
      {text}
    </span>
  );
}

export function ProgramDetailSheet({
  program,
  open,
  onOpenChange,
  applied,
  onApply,
}: {
  program: CareerProgramView | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  applied?: boolean;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const Icon = program ? ICON[program.kind] ?? Briefcase : Briefcase;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-md mx-auto">
        {program && (
          <>
            <DrawerHeader className="text-left">
              <div className="flex items-center gap-2">
                <span className="grid place-items-center w-9 h-9 rounded-xl bg-primary/10 border border-primary/30 text-primary">
                  <Icon className="w-5 h-5" />
                </span>
                {program.region === "Intl" && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: DEALER_GOLD }}>
                    <Globe className="w-3 h-3" />
                    {t("dealer.careers.intl", "Quốc tế")}
                  </span>
                )}
              </div>
              <DrawerTitle className="text-lg">{program.title}</DrawerTitle>
              <DrawerDescription>{program.subtitle}</DrawerDescription>
            </DrawerHeader>

            <div className="px-4 pb-2 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {program.payRange && <Chip icon={Wallet} text={program.payRange} gold />}
                {program.location && (
                  <Chip icon={MapPin} text={[program.region, program.location].filter(Boolean).join(" · ")} />
                )}
              </div>
              {program.gameTypes?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {program.gameTypes.map((g) => (
                    <span key={g} className="text-[11px] text-foreground/80 bg-muted/60 rounded-md px-2 py-0.5">
                      {g}
                    </span>
                  ))}
                </div>
              ) : null}
              {program.description && (
                <p className="text-[13px] text-muted-foreground leading-relaxed">{program.description}</p>
              )}
              {program.requirements?.length ? (
                <div>
                  <div className="text-[12px] font-bold text-foreground mb-1">
                    {t("dealer.careers.detail.requirements", "Yêu cầu")}
                  </div>
                  <ul className="space-y-1">
                    {program.requirements.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12px] text-muted-foreground">
                        <Check className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <DrawerFooter>
              {applied ? (
                <Button disabled className="bg-muted text-muted-foreground hover:bg-muted">
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  {t("dealer.careers.applied", "Đã ứng tuyển")}
                </Button>
              ) : (
                <Button onClick={onApply} className="gradient-neon text-primary-foreground border-0 font-bold">
                  {t("dealer.careers.detail.apply", "Ứng tuyển")}
                </Button>
              )}
              <DrawerClose asChild>
                <Button variant="outline">{t("dealer.careers.detail.close", "Đóng")}</Button>
              </DrawerClose>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
