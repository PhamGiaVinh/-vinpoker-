// Public "Giải thưởng" (payouts) tab — RPT-style results: a Champion card + the
// payout list with the FINISHER's name per place + entries + prize pool. Names come
// from get_tournament_leaderboard (finish positions); the prize structure comes from
// tournament_prizes (anon-readable). If the leaderboard RPC isn't public yet it
// degrades to the prize structure alone (amounts only). No writes.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Trophy, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatStack } from "../LiveFelt";

interface PrizeRow { position: number; amount: number; percentage: number }
interface Finisher { name: string; prize: number }

export function PrizesPanel({ tournamentId }: { tournamentId: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PrizeRow[] | null>(null);
  const [finishers, setFinishers] = useState<Record<number, Finisher>>({});
  const [entries, setEntries] = useState<number | null>(null);
  const [prizePool, setPrizePool] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Prize structure (always available, anon-readable).
      const prizesP = supabase
        .from("tournament_prizes")
        .select("position, amount, percentage")
        .eq("tournament_id", tournamentId)
        .order("position", { ascending: true });
      // Finishers / champion (needs the leaderboard RPC to be public — degrades if not).
      const lbP = supabase.rpc("get_tournament_leaderboard", { p_tournament_id: tournamentId });
      const [{ data: prizes }, lbRes] = await Promise.all([prizesP, lbP]);
      if (!alive) return;
      setRows((prizes ?? []) as PrizeRow[]);

      const lb = (lbRes?.data ?? null) as { players?: { position?: number; player_name?: string; prize?: number }[]; prize_pool?: number } | null;
      const players = lb?.players ?? [];
      const byPos: Record<number, Finisher> = {};
      for (const p of players) {
        const pos = Number(p.position) || 0;
        if (pos > 0) byPos[pos] = { name: (p.player_name || "").trim(), prize: Number(p.prize) || 0 };
      }
      setFinishers(byPos);
      setEntries(players.length || null);
      setPrizePool(lb?.prize_pool ?? null);
    })();
    return () => { alive = false; };
  }, [tournamentId]);

  if (rows === null) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-emerald-400" /></div>;
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/40 py-10 text-center text-sm text-muted-foreground">
        {t("liveHub.prizes.empty", "Chưa có cơ cấu giải thưởng")}
      </div>
    );
  }

  const champion = finishers[1];
  const totalStructure = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const pool = prizePool ?? totalStructure;

  return (
    <div className="space-y-2.5">
      {champion && champion.name && (
        <div
          className="flex items-center gap-3 rounded-xl border px-3.5 py-3"
          style={{ borderColor: "hsl(var(--poker-gold) / 0.55)", background: "linear-gradient(110deg, hsl(var(--poker-gold)/0.16), transparent 70%)" }}
        >
          <Crown className="h-7 w-7 shrink-0" style={{ color: "hsl(var(--poker-gold))" }} />
          <div className="min-w-0 flex-1">
            <div className="tracker-display text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("liveHub.prizes.champion", "Nhà vô địch")}
            </div>
            <div className="truncate text-base font-extrabold text-foreground">{champion.name}</div>
          </div>
          {champion.prize > 0 && (
            <div className="tracker-num shrink-0 text-lg font-bold" style={{ color: "hsl(var(--poker-gold))" }}>{formatStack(champion.prize)}</div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 rounded-xl border border-border/50 bg-card/50 px-3.5 py-2 text-[12px]">
        {entries != null && entries > 0 && (
          <span className="text-muted-foreground">{t("liveHub.prizes.entries", "Entries")}: <b className="tracker-num text-foreground">{entries}</b></span>
        )}
        <span className="text-muted-foreground">{t("liveHub.prizes.total", "Tổng thưởng")}: <b className="tracker-num" style={{ color: "hsl(var(--poker-gold))" }}>{formatStack(pool)}</b></span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-card/70 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">{t("liveHub.prizes.position", "Hạng")}</th>
              <th className="px-3 py-2 text-left font-semibold">{t("liveHub.prizes.player", "Người chơi")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("liveHub.prizes.amount", "Tiền thưởng")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const top = r.position <= 3;
              const who = finishers[r.position]?.name;
              return (
                <tr key={r.position} className="border-t border-border/30">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                      {top && <Trophy className="h-3.5 w-3.5" style={{ color: "hsl(var(--poker-gold))" }} />}
                      {t("liveHub.prizes.rank", "#{{n}}", { n: r.position })}
                    </span>
                  </td>
                  <td className="px-3 py-2 truncate text-foreground">{who || <span className="text-muted-foreground/60">—</span>}</td>
                  <td className="px-3 py-2 text-right">
                    <span className="tracker-num font-bold" style={{ color: top ? "hsl(var(--poker-gold))" : "hsl(var(--success))" }}>
                      {formatStack(r.amount)}
                    </span>
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
