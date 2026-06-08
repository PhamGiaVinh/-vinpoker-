import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Play, Pause, SkipForward, RefreshCw } from "lucide-react";

interface ClockData {
  tournament_id: string;
  status: string;
  is_running: boolean;
  elapsed_seconds: number;
  remaining_seconds: number;
  current_level: {
    id: string;
    level_number: number;
    small_blind: number;
    big_blind: number;
    ante: number;
    duration_minutes: number;
    is_break: boolean;
  } | null;
  is_break: boolean;
  next_level: {
    id: string;
    level_number: number;
    small_blind: number;
    big_blind: number;
    ante: number;
    duration_minutes: number;
    is_break: boolean;
  } | null;
}

export function ClockPanel({ tournamentId, refreshTrigger }: { tournamentId: string; refreshTrigger?: number }) {
  const [clock, setClock] = useState<ClockData | null>(null);
  const [loading, setLoading] = useState(false);
  const [localRemaining, setLocalRemaining] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const loadClock = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    const c = data as ClockData;
    setClock(c);
    setLocalRemaining(c.remaining_seconds);
    setIsRunning(c.is_running);
  }, [tournamentId]);

  useEffect(() => { loadClock(); }, [loadClock, refreshTrigger]);

  // Client-side countdown
  useEffect(() => {
    if (!isRunning || localRemaining <= 0) return;
    const interval = setInterval(() => {
      setLocalRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, localRemaining]);

  const handleClockAction = async (action: string, extra?: any) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-clock", {
        body: { tournament_id: tournamentId, action, ...extra },
      });
      if (error || data?.error) { toast.error(data?.error || error?.message); return; }
      toast.success("OK");
      loadClock();
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Tournament Clock</div>
        <Button size="sm" variant="outline" onClick={loadClock} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </div>

      {clock && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-4xl font-mono font-bold tabular-nums">
              {formatTime(Math.max(0, localRemaining))}
            </div>
            <div className="flex items-center gap-2">
              {!clock.is_running ? (
                <Button size="sm" onClick={() => handleClockAction("start")} disabled={loading}>
                  <Play className="w-4 h-4 mr-1" /> Bắt đầu
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => handleClockAction("pause")} disabled={loading}>
                  <Pause className="w-4 h-4 mr-1" /> Tạm dừng
                </Button>
              )}
              {clock.clock_paused_at && (
                <Button size="sm" variant="outline" onClick={() => handleClockAction("resume")} disabled={loading}>
                  <Play className="w-4 h-4 mr-1" /> Tiếp tục
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => handleClockAction("next_level", { current_level: (clock.current_level?.level_number ?? 0) + 1 })} disabled={loading}>
                <SkipForward className="w-4 h-4 mr-1" /> Next Level
              </Button>
            </div>
          </div>

          {clock.current_level && (
            <div className="text-sm space-y-1">
              <div className="font-medium">Level {clock.current_level.level_number} {clock.current_level.is_break ? "(Break)" : ""}</div>
              <div className="text-muted-foreground">
                Blinds: {clock.current_level.small_blind}/{clock.current_level.big_blind}
                {clock.current_level.ante > 0 ? ` · Ante: ${clock.current_level.ante}` : ""}
              </div>
            </div>
          )}

          {clock.next_level && (
            <div className="text-xs text-muted-foreground">
              Next: Level {clock.next_level.level_number} · {clock.next_level.small_blind}/{clock.next_level.big_blind}
              {clock.next_level.ante > 0 ? ` · Ante: ${clock.next_level.ante}` : ""}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
