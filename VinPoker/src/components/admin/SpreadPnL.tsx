import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { TrendingUp, Loader2 } from "lucide-react";
import { formatVND } from "@/lib/format";

interface Row {
  ngay: string;
  so_giao_dich: number;
  tong_vnd: number;
}

export const SpreadPnL = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ vnd: 0, count: 0 });

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from("staking_purchases")
        .select("amount_vnd, funded_at, status")
        .eq("status", "funded")
        .gte("funded_at", since)
        .order("funded_at", { ascending: false });

      const byDay = new Map<string, Row>();
      let tVnd = 0, tCount = 0;
      for (const p of (data ?? []) as any[]) {
        if (!p.funded_at) continue;
        const day = String(p.funded_at).slice(0, 10);
        const cur = byDay.get(day) ?? { ngay: day, so_giao_dich: 0, tong_vnd: 0 };
        cur.so_giao_dich += 1;
        cur.tong_vnd += Number(p.amount_vnd);
        byDay.set(day, cur);
        tVnd += Number(p.amount_vnd); tCount += 1;
      }
      setRows(Array.from(byDay.values()).sort((a, b) => b.ngay.localeCompare(a.ngay)));
      setTotals({ vnd: tVnd, count: tCount });
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4 border-primary/40 bg-primary/5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Tổng VND nhận escrow (30 ngày)</div>
          <div className="text-xl font-bold text-primary">{formatVND(totals.vnd)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Số giao dịch</div>
          <div className="text-xl font-bold">{totals.count}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3 font-bold">
          <TrendingUp className="w-3.5 h-3.5" /> Doanh số theo ngày
        </div>
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2">Ngày</th>
                  <th className="text-right py-2 px-2">Số GD</th>
                  <th className="text-right py-2 px-2">Tổng VND</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ngay} className="border-b border-border/50">
                    <td className="py-1.5 px-2">{r.ngay}</td>
                    <td className="py-1.5 px-2 text-right">{r.so_giao_dich}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{formatVND(r.tong_vnd)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={3} className="text-center py-6 text-muted-foreground">Chưa có giao dịch funded</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
