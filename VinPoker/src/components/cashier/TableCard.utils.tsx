import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from "react";
import type { TableCardAssignment, TableCardSwingConfig, TableCardTimerResult } from "./TableCard.types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtMMSS(totalSeconds: number): string {
  const abs = Math.abs(totalSeconds);
  const m = Math.floor(abs / 60).toString().padStart(2, "0");
  const s = (abs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function calcProgress(
  now: Date,
  assignedAt: string,
  swingDurationMinutes: number,
): number {
  const elapsedMin = (now.getTime() - new Date(assignedAt).getTime()) / 1000 / 60;
  return Math.min(100, Math.max(0, (elapsedMin / swingDurationMinutes) * 100));
}

// ─── computeTimer — pure function ───────────────────────────────────────────
// Priority order: OT → Overdue/OT-estimate → Urgent/Crit → Warn → Normal

/** Map mode to glow intensity 0–1. Higher = more urgent, stronger glow. */
function glowForMode(mode: TableCardTimerResult["mode"]): number {
  switch (mode) {
    case "overdue": return 1.0;
    case "ot":      return 0.9;
    case "urgent":  return 0.7;
    case "warn":    return 0.4;
    default:        return 0.15;
  }
}

function computeTimer(
  now: Date,
  assignment: TableCardAssignment | null,
  config: TableCardSwingConfig,
): TableCardTimerResult {
  if (!assignment) {
    return {
      mode: "normal", label: "--:--", progress: 0, remainingSec: 0,
      isConfirmedOt: false, glowIntensity: 0,
    };
  }

  const { swing_duration_minutes, warn_at_minutes, crit_at_minutes } = config;

  // Priority 1: OT confirmed by server (overtime_started_at is authoritative)
  if (assignment.overtime_started_at) {
    const otSec = Math.floor(
      (now.getTime() - new Date(assignment.overtime_started_at).getTime()) / 1000,
    );
    return {
      mode: "ot",
      label: `+${fmtMMSS(otSec)}`,
      progress: 100,
      remainingSec: -otSec,
      isConfirmedOt: true,
      glowIntensity: glowForMode("ot"),
    };
  }

  const remainingSec = Math.floor(
    (new Date(assignment.swing_due_at).getTime() - now.getTime()) / 1000,
  );

  // Priority 2: Clock past 0 — show OT format immediately before server confirms
  if (remainingSec <= 0) {
    const estimatedOtSec = Math.abs(remainingSec);
    return {
      mode: "ot",
      label: `+${fmtMMSS(estimatedOtSec)}`,
      progress: 100,
      remainingSec: -estimatedOtSec,
      isConfirmedOt: false,
      glowIntensity: glowForMode("ot"),
    };
  }

  const progress = calcProgress(now, assignment.assigned_at, swing_duration_minutes);

  // Priority 3: Critical
  if (remainingSec <= crit_at_minutes * 60) {
    return {
      mode: "urgent", label: fmtMMSS(remainingSec), progress, remainingSec,
      isConfirmedOt: false, glowIntensity: glowForMode("urgent"),
    };
  }

  // Priority 4: Warning
  if (remainingSec <= warn_at_minutes * 60) {
    return {
      mode: "warn", label: fmtMMSS(remainingSec), progress, remainingSec,
      isConfirmedOt: false, glowIntensity: glowForMode("warn"),
    };
  }

  // Priority 5: Normal
  return {
    mode: "normal", label: fmtMMSS(remainingSec), progress, remainingSec,
    isConfirmedOt: false, glowIntensity: glowForMode("normal"),
  };
}

// ─── ClockContext — 1 interval for all cards ─────────────────────────────────

const ClockContext = createContext<Date>(new Date());

function ClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Align to next second boundary for accurate countdown
    const msToNextSecond = 1000 - (Date.now() % 1000);
    let id: ReturnType<typeof setInterval>;

    const timeout = setTimeout(() => {
      setNow(new Date());
      id = setInterval(() => setNow(new Date()), 1000);
    }, msToNextSecond);

    return () => {
      clearTimeout(timeout);
      clearInterval(id);
    };
  }, []);

  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}

function useClock(): Date {
  return useContext(ClockContext);
}

// ─── useTableTimer — memoized timer hook ─────────────────────────────────────
// Uses primitive deps to ensure useMemo actually caches

function useTableTimer(
  assignment: TableCardAssignment | null,
  config: TableCardSwingConfig,
): TableCardTimerResult {
  const now = useClock();

  return useMemo(
    () => computeTimer(now, assignment, config),
    [
      now.getTime(),
      assignment?.id,
      assignment?.assigned_at,
      assignment?.swing_due_at,
      assignment?.overtime_started_at,
      config.swing_duration_minutes,
      config.warn_at_minutes,
      config.crit_at_minutes,
    ],
  );
}
