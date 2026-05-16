import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { distributionByClass, distributionByGroup } from "@/lib/gto/handMath";

const CLASS_COLORS: Record<string, string> = {
  pair: "hsl(142 70% 45%)",
  suited: "hsl(0 75% 55%)",
  offsuit: "hsl(210 80% 55%)",
};
const GROUP_COLOR = "hsl(var(--primary))";

export default function DistributionCharts({ selected }: { selected: Set<string> }) {
  const { t } = useTranslation();

  const pieData = useMemo(() => {
    const d = distributionByClass(selected);
    return [
      { name: t("gto.cls.pair"), key: "pair", value: d.pair },
      { name: t("gto.cls.suited"), key: "suited", value: d.suited },
      { name: t("gto.cls.offsuit"), key: "offsuit", value: d.offsuit },
    ].filter((x) => x.value > 0);
  }, [selected, t]);

  const barData = useMemo(() => {
    const d = distributionByGroup(selected);
    return [
      { name: t("gto.grp.pair"), value: d.pair },
      { name: t("gto.grp.broadway"), value: d.broadway },
      { name: t("gto.grp.suitedConnector"), value: d.suitedConnector },
      { name: t("gto.grp.Ax"), value: d.Ax },
      { name: t("gto.grp.other"), value: d.other },
    ];
  }, [selected, t]);

  return (
    <div className="grid gap-3">
      <Card className="p-3">
        <div className="text-sm font-semibold mb-2">{t("gto.distByType")}</div>
        <div className="h-56">
          {pieData.length === 0 ? (
            <div className="h-full grid place-items-center text-xs text-muted-foreground">{t("gto.empty")}</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                  {pieData.map((e) => <Cell key={e.key} fill={CLASS_COLORS[e.key]} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="p-3">
        <div className="text-sm font-semibold mb-2">{t("gto.distByGroup")}</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill={GROUP_COLOR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
