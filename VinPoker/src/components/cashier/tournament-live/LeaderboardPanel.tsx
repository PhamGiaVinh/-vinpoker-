import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { RefreshCw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TournamentLeaderboard } from "@/types/tournament";

export function LeaderboardPanel({ tournamentId, refreshTrigger }: { tournamentId: string; refreshTrigger?: number }) {
  const [leaderboard, setLeaderboard] = useState<TournamentLeaderboard | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("tournament-live-leaderboard", {
      body: { tournament_id: tournamentId },
    });
    setLoading(false);
    if (error || data?.error) { toast.error(data?.error || error?.message); return; }
    setLeaderboard(data?.data ?? null);
  }, [tournamentId]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          <Trophy className="w-4 h-4" /> Leaderboard
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </div>

      {leaderboard && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Còn lại: {leaderboard.players_remaining} · ITM: {leaderboard.itm_places} · AVG: {leaderboard.average_stack?.toLocaleString() ?? "—"} · Prize Pool: {leaderboard.prize_pool?.toLocaleString() ?? "—"}
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">Player</th>
                  <th className="text-right p-2">Stack</th>
                  <th className="text-right p-2">Position</th>
                  <th className="text-right p-2">Prize</th>
                  <th className="text-center p-2">ITM</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.players.map((p, idx) => (
                  <tr key={`${p.player_id}-${p.entry_number}`} className={`border-b ${p.is_itm ? "bg-emerald-500/10" : ""}`}>
                    <td className="p-2">{idx + 1}</td>
                    <td className="p-2 font-medium">{p.player_name?.trim() || p.player_id.slice(0, 8)}</td>
                    <td className="p-2 text-right font-mono">{p.chip_count.toLocaleString()}</td>
                    <td className="p-2 text-right">{p.position || "—"}</td>
                    <td className="p-2 text-right">{p.prize ? p.prize.toLocaleString() : "—"}</td>
                    <td className="p-2 text-center">{p.is_itm ? "✓" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
