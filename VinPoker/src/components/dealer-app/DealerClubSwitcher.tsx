import { useTranslation } from "react-i18next";
import { ChevronDown, Building2, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useDealerLink } from "@/hooks/dealer/useDealerLink";

/** Header club switcher — shown only when the user is a dealer of more than one
 *  club. Picking a club updates the shared selection; the schedule hooks refetch
 *  for that club's `dealers` row. */
export function DealerClubSwitcher() {
  const { t } = useTranslation();
  const { memberships, dealer, setSelectedDealerId } = useDealerLink();
  if (memberships.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 max-w-[40vw] px-2 h-8 rounded-lg bg-card border border-border text-foreground text-[12px] font-bold hover:border-primary/40 transition-colors"
          aria-label={t("dealer.club.switch", "Đổi CLB")}
        >
          <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="truncate">{dealer?.clubName || t("dealer.club.switch", "Đổi CLB")}</span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t("dealer.club.label", "Câu lạc bộ")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {memberships.map((m) => (
          <DropdownMenuItem key={m.dealerId} onClick={() => setSelectedDealerId(m.dealerId)} className="gap-2 cursor-pointer">
            <Building2 className="w-4 h-4" />
            <span className="flex-1 truncate">{m.clubName}</span>
            {m.dealerId === dealer?.dealerId && <Check className="w-4 h-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
