import { useEffect, useMemo, useRef, useState } from "react";
import {
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SkipBack,
  SkipForward,
  TimerReset,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { floorOpsErrorMessage, floorOpsFunctionErrorCode } from "@/lib/floorOpsErrors";
import {
  canUseTournamentClockPostStartControls,
  getTournamentClockPrimaryAction,
} from "@/lib/tournament/clockControlState";
import { useTournamentOps } from "@/ops/floor/TournamentOpsProvider";

const mmss = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
};

const blind = (value: number | null | undefined) =>
  value == null ? "—" : value.toLocaleString("vi-VN");

export default function ClockWorkspace() {
  const client = useSupabaseClient();
  const { tournamentId, clock, levels, errors, refresh } = useTournamentOps();
  const [localRemaining, setLocalRemaining] = useState(clock?.remaining_seconds ?? 0);
  const [busy, setBusy] = useState(false);
  const actionGuard = useRef(false);
  const clockIsRunning = clock?.is_running === true;

  useEffect(() => {
    setLocalRemaining(clock?.remaining_seconds ?? 0);
  }, [clock?.control_revision, clock?.remaining_seconds]);

  useEffect(() => {
    if (!clockIsRunning) return;
    const timer = window.setInterval(() => {
      setLocalRemaining((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [clockIsRunning]);

  const primaryAction = clock ? getTournamentClockPrimaryAction(clock) : null;
  const postStartControls = clock ? canUseTournamentClockPostStartControls(clock) : false;
  const currentLevel = clock?.current_level ?? null;
  const actionLabel = primaryAction === "start"
    ? "Bắt đầu"
    : primaryAction === "pause"
      ? "Tạm dừng"
      : primaryAction === "resume"
        ? "Tiếp tục"
        : null;
  const PrimaryIcon = primaryAction === "pause" ? Pause : Play;

  const runAction = async (action: string, extra?: Record<string, unknown>) => {
    if (!clock || actionGuard.current) return;
    const expectedRevision = action === "start" ? null : clock.control_revision;
    if (action !== "start" && !expectedRevision) {
      toast.error("Đồng hồ vừa thay đổi. Hãy tải lại trước khi thao tác.");
      refresh();
      return;
    }
    actionGuard.current = true;
    setBusy(true);
    try {
      const { data, error } = await client.functions.invoke("tournament-live-clock", {
        body: {
          tournament_id: tournamentId,
          action,
          ...extra,
          ...(expectedRevision ? { expected_control_revision: expectedRevision } : {}),
        },
      });
      const code = await floorOpsFunctionErrorCode(data, error);
      if (code) {
        toast.error(floorOpsErrorMessage(code, "Không điều khiển được đồng hồ"));
        refresh();
        return;
      }
      toast.success("Đồng hồ đã được cập nhật.");
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? `Lỗi mạng: ${cause.message}` : "Không điều khiển được đồng hồ");
    } finally {
      actionGuard.current = false;
      setBusy(false);
    }
  };

  const levelRows = useMemo(
    () => levels.map((level) => ({
      ...level,
      active: currentLevel?.level_number === level.levelNumber,
    })),
    [currentLevel?.level_number, levels],
  );

  return (
    <div className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Không gian giải</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Đồng hồ & Blind</h2>
          <p className="mt-1 text-sm text-[#91a49b]">
            Server giữ trạng thái chuẩn; màn hình này không tự chuyển level khi bộ đếm về 0.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 border-white/10 bg-white/5 text-white"
          disabled={busy}
          onClick={refresh}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </header>

      {errors.clock && (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-200">
          {errors.clock}
        </div>
      )}

      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#91a49b]">
              <TimerReset className="h-4 w-4 text-emerald-300" />
              {clock?.is_break ? "Giải lao" : `Level ${currentLevel?.level_number ?? "—"}`}
            </div>
            <div className="mt-3 font-mono text-5xl font-bold tabular-nums text-white sm:text-7xl">
              {mmss(localRemaining)}
            </div>
            <p className="mt-3 text-sm text-[#a8b8b0]">
              Blind {blind(currentLevel?.small_blind)} / {blind(currentLevel?.big_blind)}
              {currentLevel?.ante ? ` · Ante ${blind(currentLevel.ante)}` : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:max-w-sm lg:justify-end">
            {primaryAction && actionLabel && (
              <Button
                type="button"
                className="min-h-12"
                variant={primaryAction === "start" ? "default" : "outline"}
                disabled={busy}
                onClick={() => void runAction(primaryAction)}
              >
                <PrimaryIcon className="mr-2 h-5 w-5" />
                {actionLabel}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="min-h-12 border-white/10 bg-white/5"
              disabled={busy || !postStartControls || (currentLevel?.level_number ?? 1) <= 1}
              onClick={() => void runAction("previous_level")}
            >
              <SkipBack className="mr-2 h-5 w-5" />
              Level trước
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-12 border-white/10 bg-white/5"
              disabled={busy || !postStartControls || !clock?.next_level}
              onClick={() => void runAction("next_level")}
            >
              <SkipForward className="mr-2 h-5 w-5" />
              Level sau
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-12 border-white/10 bg-white/5"
              disabled={busy || !postStartControls}
              onClick={() => void runAction("adjust_time", { delta_seconds: -60 })}
            >
              <Minus className="mr-2 h-5 w-5" />
              1 phút
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-12 border-white/10 bg-white/5"
              disabled={busy || !postStartControls}
              onClick={() => void runAction("adjust_time", { delta_seconds: 60 })}
            >
              <Plus className="mr-2 h-5 w-5" />
              1 phút
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-white">Cấu trúc blind</h3>
        {errors.levels ? (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
            {errors.levels}
          </div>
        ) : levelRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-[#789084]">
            Chưa có cấu trúc blind.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            {levelRows.map((level) => (
              <div
                key={level.id}
                className={`grid min-h-14 grid-cols-[5rem_minmax(0,1fr)_5rem] items-center gap-3 border-b border-white/8 px-4 text-sm last:border-0 ${
                  level.active ? "bg-emerald-300/10 text-emerald-100" : "bg-white/[0.025] text-[#b8c6bf]"
                }`}
              >
                <span className="font-semibold">{level.isBreak ? "Nghỉ" : `Level ${level.levelNumber}`}</span>
                <span className="truncate font-mono">
                  {level.isBreak
                    ? "—"
                    : `${blind(level.smallBlind)} / ${blind(level.bigBlind)}${level.ante ? ` · ${blind(level.ante)}` : ""}`}
                </span>
                <span className="text-right">{level.durationMinutes} phút</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
