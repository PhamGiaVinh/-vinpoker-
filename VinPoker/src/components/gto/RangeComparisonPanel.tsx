import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PRESET_NAMES } from "@/lib/gto/presets";
import { presetPercent, heuristicEquity } from "@/lib/gto/equity";

type Side = "hero" | "villain";

export default function RangeComparisonPanel() {
  const { t } = useTranslation();
  const [hero, setHero] = useState<string>("BTN");
  const [villain, setVillain] = useState<string>("random");

  const heroPct = useMemo(() => presetPercent(hero), [hero]);
  const villainPct = useMemo(
    () => (villain === "random" ? 100 : presetPercent(villain)),
    [villain],
  );

  const eq = useMemo(() => heuristicEquity(heroPct, villainPct), [heroPct, villainPct]);

  const data = [
    { name: t("gto.compare.hero"), value: eq.hero },
    { name: t("gto.compare.villain"), value: eq.villain },
  ];

  const PickRow = ({ side }: { side: Side }) => {
    const value = side === "hero" ? hero : villain;
    const set = side === "hero" ? setHero : setVillain;
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold">
          {side === "hero" ? t("gto.compare.hero") : t("gto.compare.villain")}
        </div>
        <div className="flex flex-wrap gap-1">
          {side === "villain" && (
            <Button
              size="sm"
              variant={value === "random" ? "default" : "secondary"}
              onClick={() => set("random")}
            >
              {t("gto.compare.random")}
            </Button>
          )}
          {PRESET_NAMES.map((p) => (
            <Button
              key={`${side}-${p}`}
              size="sm"
              variant={value === p ? "default" : "secondary"}
              onClick={() => set(p)}
            >
              {p}
            </Button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card className="p-4 space-y-3">
      <h3 className="font-semibold">{t("gto.compare.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("gto.compare.heuristic")}</p>

      <div className="grid sm:grid-cols-2 gap-3">
        <PickRow side="hero" />
        <PickRow side="villain" />
      </div>

      <div className="rounded-md bg-muted p-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span>{t("gto.compare.hero")} ({heroPct.toFixed(1)}%)</span>
          <span className="font-semibold">{eq.hero.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span>{t("gto.compare.villain")} ({villainPct.toFixed(1)}%)</span>
          <span className="font-semibold">{eq.villain.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{t("gto.compare.tie")}</span>
          <span>{eq.tie.toFixed(1)}%</span>
        </div>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              dataKey="value"
              label={({ name, value }) => `${name}: ${(value as number).toFixed(1)}%`}
            >
              <Cell fill="hsl(var(--primary))" />
              <Cell fill="hsl(var(--destructive))" />
            </Pie>
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                color: "hsl(var(--popover-foreground))",
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
