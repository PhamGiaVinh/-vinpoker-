import { useEffect, useState } from "react";
import { Clock3, Pause, Radio, TimerOff } from "lucide-react";
import { fmtCompact } from "../viewer-hub/hubDerive";
import { tickPublicClock, type PublicTournamentEventSnapshot } from "./publicTournamentEvent";

interface PublicTournamentRailProps {
  snapshot: PublicTournamentEventSnapshot;
}

const PHASE_COPY = {
  running: { label: "Đang chạy", Icon: Radio, tone: "text-emerald-300" },
  paused: { label: "Tạm dừng", Icon: Pause, tone: "text-amber-300" },
  break: { label: "Nghỉ giải lao", Icon: Clock3, tone: "text-sky-300" },
  not_started: { label: "Chưa bắt đầu", Icon: TimerOff, tone: "text-slate-300" },
  completed: { label: "Đã hoàn tất", Icon: TimerOff, tone: "text-slate-300" },
} as const;

export function PublicTournamentRail({ snapshot }: PublicTournamentRailProps) {
  const [remaining, setRemaining] = useState(snapshot.clock.remainingSeconds);
  const phase = PHASE_COPY[snapshot.clock.phase];
  const PhaseIcon = phase.Icon;

  useEffect(() => {
    setRemaining(snapshot.clock.remainingSeconds);
  }, [snapshot.clock.remainingSeconds, snapshot.refreshedAt]);

  useEffect(() => {
    if (!snapshot.clock.isAdvancing) return;
    const timer = window.setInterval(() => {
      setRemaining((current) => tickPublicClock(current, true));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot.clock.isAdvancing]);

  return (
    <section
      aria-label="Thông tin trực tiếp của giải"
      className="relative overflow-hidden rounded-[1.4rem] border border-emerald-300/20 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_40%),linear-gradient(145deg,rgba(9,22,17,0.98),rgba(4,11,9,0.98))] px-4 py-4 shadow-[0_22px_70px_-38px_rgba(16,185,129,0.8)] sm:px-5 lg:px-6"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-emerald-300 via-emerald-500 to-transparent" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_auto_minmax(0,1.15fr)] lg:items-center">
        <div className="min-w-0">
          <div className={`flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] ${phase.tone}`}>
            <PhaseIcon className="h-4 w-4" aria-hidden="true" />
            {phase.label}
            {snapshot.dataQuality === "stale" && (
              <span className="rounded-full border border-amber-300/35 bg-amber-300/10 px-2 py-1 text-[10px] tracking-normal text-amber-200">
                Dữ liệu chậm cập nhật
              </span>
            )}
          </div>
          <h1 className="mt-2 truncate text-xl font-black tracking-tight text-white sm:text-2xl">
            {snapshot.tournament.name}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
            <StatPill label="Entries" value={String(snapshot.entries)} />
            <StatPill label="Còn lại" value={snapshot.playersRemaining == null ? "—" : String(snapshot.playersRemaining)} />
            <StatPill label="AVG" value={snapshot.averageStack == null ? "—" : fmtCompact(snapshot.averageStack)} />
          </div>
        </div>

        <div className="flex items-end justify-between gap-4 border-y border-white/10 py-3 lg:min-w-44 lg:justify-center lg:border-x lg:border-y-0 lg:px-6 lg:py-1">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Level</div>
            <div className="mt-1 text-2xl font-black tabular-nums text-white">
              {snapshot.clock.levelNumber ?? "—"}
            </div>
          </div>
          <div className="text-right lg:text-left">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Đồng hồ</div>
            <div className="mt-1 font-mono text-3xl font-black tabular-nums text-emerald-300 sm:text-4xl">
              {formatClock(remaining)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 items-stretch gap-2 sm:gap-3">
          <BlindBlock
            label="Blinds hiện tại"
            blinds={formatBlinds(snapshot.clock.smallBlind, snapshot.clock.bigBlind, snapshot.clock.bigBlindAnte)}
            active
          />
          <BlindBlock
            label="Level tiếp"
            blinds={formatBlinds(snapshot.clock.nextSmallBlind, snapshot.clock.nextBigBlind, snapshot.clock.nextBigBlindAnte)}
          />
        </div>
      </div>
    </section>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.045] px-3">
      <span className="text-slate-500">{label}</span>
      <strong className="tabular-nums text-slate-100">{value}</strong>
    </span>
  );
}

function BlindBlock({ label, blinds, active = false }: { label: string; blinds: string; active?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">{label}</div>
      <div className={`mt-1 break-words text-sm font-black leading-5 tabular-nums sm:text-base lg:text-lg ${active ? "text-white" : "text-slate-300"}`}>
        {blinds}
      </div>
    </div>
  );
}

function formatBlinds(sb: number | null, bb: number | null, ante: number | null): string {
  if (sb == null || bb == null || sb <= 0 || bb <= 0) return "—";
  const core = `${fmtCompact(sb)} / ${fmtCompact(bb)}`;
  return ante != null && ante > 0 ? `${core} · BBA ${fmtCompact(ante)}` : core;
}

function formatClock(seconds: number | null): string {
  if (seconds == null) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
