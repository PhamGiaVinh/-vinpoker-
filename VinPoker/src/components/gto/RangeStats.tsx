import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { totalCombos, percentRange, TOTAL_COMBOS } from "@/lib/gto/handMath";

export default function RangeStats({ selected }: { selected: Set<string> }) {
  const { t } = useTranslation();
  const combos = totalCombos(selected);
  const pct = percentRange(selected);
  return (
    <div className="grid grid-cols-3 gap-2">
      <Card className="p-3 text-center">
        <div className="text-2xl font-bold text-primary">{combos}</div>
        <div className="text-xs text-muted-foreground">{t("gto.combos")} / {TOTAL_COMBOS}</div>
      </Card>
      <Card className="p-3 text-center">
        <div className="text-2xl font-bold text-primary">{pct.toFixed(1)}%</div>
        <div className="text-xs text-muted-foreground">{t("gto.percentRange")}</div>
      </Card>
      <Card className="p-3 text-center">
        <div className="text-2xl font-bold text-primary">{selected.size}</div>
        <div className="text-xs text-muted-foreground">{t("gto.handsSelected")}</div>
      </Card>
    </div>
  );
}
