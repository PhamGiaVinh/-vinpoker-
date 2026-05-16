// Helpers for live tournament timing.
// Late reg closes at the START of `late_reg_close_level + 1`.
// e.g. minutes_per_level=20, late_reg_close_level=6 -> closes 6*20=120 minutes after start.

export interface LiveTimingInput {
  start_time: string;
  minutes_per_level?: number | null;
  late_reg_close_level?: number | null;
  live_status?: string | null;
}

export function getLateRegCloseTime(t: LiveTimingInput): Date {
  const start = new Date(t.start_time).getTime();
  const mpl = Math.max(1, t.minutes_per_level ?? 20);
  const closeLvl = Math.max(1, t.late_reg_close_level ?? 6);
  return new Date(start + closeLvl * mpl * 60_000);
}

export function getCurrentLevel(t: LiveTimingInput, now = Date.now()): number {
  const start = new Date(t.start_time).getTime();
  if (now < start) return 0;
  const mpl = Math.max(1, t.minutes_per_level ?? 20);
  return Math.floor((now - start) / (mpl * 60_000)) + 1;
}

export function getLevelEndsIn(t: LiveTimingInput, now = Date.now()): number {
  const start = new Date(t.start_time).getTime();
  if (now < start) return start - now;
  const mpl = Math.max(1, t.minutes_per_level ?? 20);
  const elapsed = now - start;
  const inLevel = elapsed % (mpl * 60_000);
  return mpl * 60_000 - inLevel;
}

export function isLateRegClosed(t: LiveTimingInput, now = Date.now()): boolean {
  if (t.live_status === "finished") return true;
  return now >= getLateRegCloseTime(t).getTime();
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
