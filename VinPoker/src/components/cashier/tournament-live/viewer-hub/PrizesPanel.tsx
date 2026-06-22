// Public "Giải thưởng" (payouts) tab — READ-ONLY prize structure for the spectator
// event view. Reads tournament_prizes (anon-readable) ordered by finish position.
// Presentational + a tiny self-contained query; no operator editor coupling, no
// writes. Empty/loading states. Stitch-Dark, theme-token colors (dark + warm safe).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatStack } from "../LiveFelt";

interface PrizeRow {
  position: number;
  amount: number;
  percentage: number;
}

export function PrizesPanel({ tournamentId }: { tournamentId: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PrizeRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("tournament_prizes")
        .select("position, amount, percentage")
        .eq("tournament_id", tournamentId)
        .order("position", { ascending: true });
      if (!alive) return;
      setRows((data ?? []) as PrizeRow[]);
    })();
    return () => {
      alive = false;
    };
  }, [tournamentId]);

  if (rows === null) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/40 py-10 text-center text-sm text-muted-foreground">
        {t("liveHub.prizes.empty", "Chưa có cơ cấu giải thưởng")}
      </div>
    );
  }

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div className="space-y-2">
      {total > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--poker-gold)/0.35)] bg-card/50 px-3.5 py-2">
          <span className="tracker-display text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("liveHub.prizes.total", "Tổng thưởng")}
          </span>
          <span className="tracker-num text-base font-bold" style={{ color: "hsl(var(--poker-gold))" }}>
            {formatStack(total)}
          </span>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-card/70 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">{t("liveHub.prizes.position", "Hạng")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("liveHub.prizes.amount", "Tiền thưởng")}</th>
              <th className="px-3 py-2 text-right font-semibold">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const top = r.position <= 3;
              return (
                <tr key={r.position} className="border-t border-border/30">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                      {top && <Trophy className="h-3.5 w-3.5" style={{ color: "hsl(var(--poker-gold))" }} />}
                      {t("liveHub.prizes.rank", "#{{n}}", { n: r.position })}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="tracker-num font-bold" style={{ color: top ? "hsl(var(--poker-gold))" : "hsl(var(--success))" }}>
                      {formatStack(r.amount)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tracker-num text-muted-foreground">
                    {r.percentage ? `${r.percentage}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
