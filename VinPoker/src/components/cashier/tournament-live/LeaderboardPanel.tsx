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

  // Read the leaderboard straight from the DB RPC (no Edge Function hop). The old
  // `tournament-live-leaderboard` Edge wrapper just called this same RPC, but when
  // it isn't deployed the client throws "Failed to send a request to the Edge
  // Function" with no fallback — calling the RPC directly is simpler and resilient.
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_tournament_leaderboard", { p_tournament_id: tournamentId });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setLeaderboard((data as unknown as TournamentLeaderboard) ?? null);
  }, [tournamentId]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  // Live chip counts: refresh when seats / chip counts / hands change for this
  // tournament (same realtime tables the tracker subscribes to). A debounce coalesces
  // bursts; if realtime is unavailable we fall back to an 8s poll.
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const refresh = () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(() => load(), 700); };
    const channel = supabase
      .channel(`leaderboard:${tournamentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_seats", filter: `tournament_id=eq.${tournamentId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_chip_counts", filter: `tournament_id=eq.${tournamentId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_hands", filter: `tournament_id=eq.${tournamentId}` }, refresh)
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (!poll) poll = setInterval(() => load(), 8000);
        } else if (status === "SUBSCRIBED" && poll) { clearInterval(poll); poll = null; }
      });
    return () => {
      if (debounce) clearTimeout(debounce);
      if (poll) clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [tournamentId, load]);

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
          {/* Mobile: stacked cards (no horizontal scroll on phone/tablet) */}
          <div className="space-y-1.5 md:hidden">
            {leaderboard.players.map((p, idx) => (
              <div
                key={`${p.player_id}-${p.entry_number}`}
                className={`flex items-center gap-2 rounded-lg border p-2 ${p.is_itm ? "border-emerald-500/40 bg-emerald-500/10" : ""}`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-bold tabular-nums">
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.player_name?.trim() || p.player_id.slice(0, 8)}</div>
                  <div className="font-mono text-xs text-muted-foreground">{p.chip_count.toLocaleString()} chip</div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  {p.position ? <div className="text-muted-foreground">#{p.position}</div> : null}
                  {p.is_itm && <div className="font-medium text-emerald-400">ITM{p.prize ? ` · ${p.prize.toLocaleString()}` : ""}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: full table */}
          <div className="hidden overflow-auto md:block">
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
