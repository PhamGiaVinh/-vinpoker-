import { useLiveClock } from "@/hooks/useLiveClock";

// ── Types ────────────────────────────────────────────────────

interface TableTimerDisplayProps {
  overtimeStartedAt: string | null;
  swingDueAt: string | null;
  className?: string;
}

// ── Root: chọn display mode dựa trên OT state ───────────────

function TableTimerDisplay({
  overtimeStartedAt,
  swingDueAt,
  className,
}: TableTimerDisplayProps) {
  if (overtimeStartedAt) {
    return <OTBadge overtimeStartedAt={overtimeStartedAt} className={className} />;
  }
  if (swingDueAt) {
    return <SwingCountdownBadge swingDueAt={swingDueAt} className={className} />;
  }
  return null;
}

// ── OT Badge — đếm TĂNG DẦN (đã OT bao lâu) ────────────────

interface OTBadgeProps {
  overtimeStartedAt: string;
  className?: string;
}

function OTBadge({ overtimeStartedAt, className }: OTBadgeProps) {
  const now = useLiveClock();
  const startMs = new Date(overtimeStartedAt).getTime();
  const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const isCritical = mins >= 5;

  return (
    <div
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold tabular-nums select-none ${
        isCritical
          ? "ot-badge--critical"
          : "ot-badge--warning"
      } ${className ?? ""}`}
      style={{ minWidth: "76px", justifyContent: "center" }}
      title={`Đang OT: ${mins} phút ${secs} giây`}
    >
      {isCritical && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
      )}
      <span>+{String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}</span>
    </div>
  );
}

// ── Swing Countdown — đếm GIẢM DẦN đến swing_due_at ─────────

interface SwingCountdownBadgeProps {
  swingDueAt: string;
  className?: string;
}

function SwingCountdownBadge({
  swingDueAt,
  className,
}: SwingCountdownBadgeProps) {
  const now = useLiveClock();
  const dueMs = new Date(swingDueAt).getTime();
  const timeLeftSec = Math.max(0, Math.floor((dueMs - now) / 1000));
  const mins = Math.floor(timeLeftSec / 60);
  const secs = timeLeftSec % 60;
  const isOverdue = dueMs <= now;
  const isUrgent = !isOverdue && mins < 3;

  if (isOverdue) {
    return (
      <div
        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold tabular-nums select-none countdown-badge--overdue ${className ?? ""}`}
        style={{ minWidth: "76px", justifyContent: "center" }}
        title="Đã đến giờ swing"
      >
        ⚠️ Overdue
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold tabular-nums select-none ${
        isUrgent ? "countdown-badge--urgent" : "countdown-badge--normal"
      } ${className ?? ""}`}
      style={{ minWidth: "76px", justifyContent: "center" }}
      title={`Swing lúc ${new Date(swingDueAt).toLocaleTimeString("vi-VN")}`}
    >
      {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
    </div>
  );
}
